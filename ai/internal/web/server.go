// Package web is the HTTP layer: server-rendered HTML plus a small JSON API on the same port.
package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"venuecheck/internal/config"
	"venuecheck/internal/osm"
	"venuecheck/internal/store"
)

//go:embed templates/*.html
var tplFS embed.FS

//go:embed static
var staticFS embed.FS

// Server wires the store, OSM clients and templates together.
type Server struct {
	cfg      *config.Config
	st       *store.Store
	wa       *webauthn.WebAuthn
	overpass *osm.Overpass
	writer   *osm.Writer
	log      *slog.Logger
	tpl      map[string]*template.Template

	chMu       sync.Mutex
	challenges map[string]challenge

	cacheMu      sync.Mutex
	elementCache map[string]cachedElement
}

type cachedElement struct {
	el osm.Element
	at time.Time
}

// New builds a Server.
func New(cfg *config.Config, st *store.Store, log *slog.Logger) (*Server, error) {
	wa, err := webauthn.New(&webauthn.Config{RPID: cfg.RPID, RPDisplayName: "VenueCheck", RPOrigins: cfg.RPOrigins})
	if err != nil {
		return nil, fmt.Errorf("configure webauthn: %w", err)
	}
	ua := fmt.Sprintf("VenueCheck/1.0 (%s)", cfg.Hostname)
	s := &Server{
		cfg: cfg, st: st, wa: wa, log: log,
		overpass:     osm.NewOverpass(cfg.OverpassURL, ua),
		writer:       osm.NewWriter(cfg.OSMAPIBase, cfg.OSMAPIKey, cfg.Hostname, ua, cfg.OSMMinGap),
		challenges:   map[string]challenge{},
		elementCache: map[string]cachedElement{},
	}
	if err := s.loadTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

var funcs = template.FuncMap{
	"date":  func(t time.Time) string { return t.UTC().Format("2 Jan 2006 15:04") },
	"day":   func(t time.Time) string { return t.UTC().Format("2 Jan 2006") },
	"month": func(t time.Time) string { return t.UTC().Format("Jan 2006") },
	"iso":   func(t time.Time) string { return t.UTC().Format("2006-01-02T15:04") },
	"ts": func(s string) string {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UTC().Format("2 Jan 2006 15:04")
		}
		return s
	},
	"add": func(a, b int) int { return a + b },
	"sub": func(a, b int) int { return a - b },
	"pct": func(n, max int) int {
		if max == 0 {
			return 0
		}
		return n * 100 / max
	},
	"maxCount": func(cs []store.Count) int {
		m := 0
		for _, c := range cs {
			if c.N > m {
				m = c.N
			}
		}
		return m
	},
	"pretty": func(s string) string {
		var v any
		if json.Unmarshal([]byte(s), &v) != nil {
			return s
		}
		b, _ := json.MarshalIndent(v, "", "  ")
		return string(b)
	},
	"urlq": url.QueryEscape,
	"list": func(v ...string) []string { return v },
}

func (s *Server) loadTemplates() error {
	s.tpl = map[string]*template.Template{}
	pages, err := fs.Glob(tplFS, "templates/*.html")
	if err != nil {
		return err
	}
	for _, p := range pages {
		name := strings.TrimSuffix(strings.TrimPrefix(p, "templates/"), ".html")
		if name == "layout" {
			continue
		}
		t, err := template.New("layout").Funcs(funcs).ParseFS(tplFS, "templates/layout.html", p)
		if err != nil {
			return fmt.Errorf("parse %s: %w", p, err)
		}
		s.tpl[name] = t
	}
	return nil
}

// Page is the common template envelope.
type Page struct {
	Title string
	User  *store.User
	CSRF  string
	Flash string
	Err   string
	Data  any
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, name string, title string, data any) {
	p := Page{Title: title, Data: data, Flash: r.URL.Query().Get("msg"), Err: r.URL.Query().Get("err")}
	if u, tok := s.sessionFrom(r); u != nil {
		p.User, p.CSRF = u, csrfToken(tok)
	}
	t, ok := s.tpl[name]
	if !ok {
		http.Error(w, "template missing", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := t.ExecuteTemplate(w, "layout", p); err != nil {
		s.log.Error("render", "template", name, "err", err)
	}
}

func csrfToken(sessionToken string) string {
	m := hmac.New(sha256.New, []byte("venuecheck-csrf"))
	m.Write([]byte(sessionToken))
	return hex.EncodeToString(m.Sum(nil))
}

type ctxKey int

const userKey ctxKey = 1

func userFrom(r *http.Request) *store.User {
	u, _ := r.Context().Value(userKey).(*store.User)
	return u
}

const sessionCookie = "vc_session"

func (s *Server) sessionFrom(r *http.Request) (*store.User, string) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, ""
	}
	u, err := s.st.SessionUser(c.Value)
	if err != nil {
		return nil, ""
	}
	return u, c.Value
}

func (s *Server) secure(r *http.Request) bool {
	return s.cfg.Secure() || r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

func (s *Server) setCookie(w http.ResponseWriter, r *http.Request, name, val string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: val, Path: "/", MaxAge: maxAge, HttpOnly: true,
		SameSite: http.SameSiteStrictMode, Secure: s.secure(r)})
}

func isUnsafe(m string) bool {
	return m != http.MethodGet && m != http.MethodHead && m != http.MethodOptions
}

// authed requires a session, validates CSRF on unsafe methods and, when admin is
// true, answers 404 to non-admins.
func (s *Server) authed(admin bool, h func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, tok := s.sessionFrom(r)
		if u == nil {
			if strings.HasPrefix(r.URL.Path, "/api/") || r.Method != http.MethodGet {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		if admin && !u.IsAdmin {
			http.NotFound(w, r)
			return
		}
		if isUnsafe(r.Method) {
			got := r.Header.Get("X-CSRF-Token")
			if got == "" {
				if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
					r.Body = http.MaxBytesReader(w, r.Body, 512<<20)
					_ = r.ParseMultipartForm(32 << 20)
				} else {
					_ = r.ParseForm()
				}
				got = r.FormValue("csrf")
			}
			if !hmac.Equal([]byte(got), []byte(csrfToken(tok))) {
				http.Error(w, "bad CSRF token", http.StatusForbidden)
				return
			}
		}
		h(w, r.WithContext(context.WithValue(r.Context(), userKey, u)))
	}
}

func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

// Handler returns the fully wired HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	static, _ := fs.Sub(staticFS, "static")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(static)))
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.st.Ping(); err != nil {
			http.Error(w, "db down", 503)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	mux.Handle("GET /tiles/", s.authed(false, s.serveTile))

	// auth
	mux.HandleFunc("GET /login", s.loginPage)
	mux.HandleFunc("GET /register", s.registerPage)
	mux.HandleFunc("POST /register/begin", s.registerBegin)
	mux.HandleFunc("POST /register/finish", s.registerFinish)
	mux.HandleFunc("POST /login/begin", s.loginBegin)
	mux.HandleFunc("POST /login/finish", s.loginFinish)
	mux.HandleFunc("POST /logout", s.authed(false, s.logout))
	mux.HandleFunc("GET /passkeys", s.authed(false, s.passkeysPage))
	mux.HandleFunc("POST /passkeys/begin", s.authed(false, s.passkeyAddBegin))
	mux.HandleFunc("POST /passkeys/finish", s.authed(false, s.passkeyAddFinish))
	mux.HandleFunc("POST /passkeys/{id}/deactivate", s.authed(false, s.passkeyDeactivate))

	// check-ins
	mux.HandleFunc("GET /{$}", s.authed(false, s.home))
	mux.HandleFunc("GET /checkin", s.authed(false, s.checkinSearchPage))
	mux.HandleFunc("GET /api/search", s.authed(false, s.apiSearch))
	mux.HandleFunc("GET /checkin/new", s.authed(false, s.checkinConfirmPage))
	mux.HandleFunc("POST /checkin", s.authed(false, s.checkinCreate))
	mux.HandleFunc("GET /checkins/{id}", s.authed(false, s.checkinDetail))
	mux.HandleFunc("POST /checkins/{id}", s.authed(false, s.checkinUpdate))
	mux.HandleFunc("POST /checkins/{id}/delete", s.authed(false, s.checkinDelete))

	// venues
	mux.HandleFunc("GET /venues", s.authed(false, s.venuesPage))
	mux.HandleFunc("GET /venues/{id}", s.authed(false, s.venueDetail))
	mux.HandleFunc("POST /venues/{id}", s.authed(false, s.venueEdit))
	mux.HandleFunc("POST /venues/{id}/refresh", s.authed(false, s.venueRefresh))

	// insights, map, export
	mux.HandleFunc("GET /insights", s.authed(false, s.insightsPage))
	mux.HandleFunc("GET /map", s.authed(false, s.mapPage))
	mux.HandleFunc("GET /api/map", s.authed(false, s.apiMap))
	mux.HandleFunc("GET /export", s.authed(false, s.exportPage))
	mux.HandleFunc("POST /export", s.authed(false, s.exportDownload))

	// admin
	mux.HandleFunc("GET /admin/venues", s.authed(true, s.adminVenues))
	mux.HandleFunc("GET /admin/venues/{id}", s.authed(true, s.adminVenue))
	mux.HandleFunc("POST /admin/venues/{id}/pull", s.authed(true, s.adminPull))
	mux.HandleFunc("POST /admin/venues/{id}/push", s.authed(true, s.adminPush))
	mux.HandleFunc("POST /admin/venues/{id}/reconcile", s.authed(true, s.adminReconcile))
	mux.HandleFunc("POST /admin/venues/{id}/link", s.authed(true, s.adminLink))
	mux.HandleFunc("POST /admin/venues/{id}/dismiss", s.authed(true, s.adminDismiss))
	mux.HandleFunc("GET /admin/import", s.authed(true, s.importPage))
	mux.HandleFunc("POST /admin/import", s.authed(true, s.importUpload))

	return secureHeaders(mux)
}

func (s *Server) redirect(w http.ResponseWriter, r *http.Request, path, msg, errMsg string) {
	q := url.Values{}
	if msg != "" {
		q.Set("msg", msg)
	}
	if errMsg != "" {
		q.Set("err", errMsg)
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	http.Redirect(w, r, path, http.StatusSeeOther)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
