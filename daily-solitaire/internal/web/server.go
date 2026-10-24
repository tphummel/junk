// Package web is the HTTP layer: server-rendered pages, Turbo-friendly
// redirects, passkey ceremonies, and the move endpoint.
package web

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"daily-solitaire/internal/config"
	"daily-solitaire/internal/dates"
	"daily-solitaire/internal/store"
)

//go:embed templates/*.html
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS

const (
	sessionTTL = 30 * 24 * time.Hour
	// freshWindow is how long a user-verified assertion counts for step-up.
	freshWindow = 5 * time.Minute
	// recoveryFreshWindow is longer: a person recovering has no passkey to
	// re-verify with and needs time to enrol a new one.
	recoveryFreshWindow = 15 * time.Minute
	ceremonyTTL         = 5 * time.Minute
)

// Server wires the store, WebAuthn relying party and templates into handlers.
type Server struct {
	cfg     *config.Config
	store   *store.Store
	wa      *webauthn.WebAuthn
	log     *slog.Logger
	pages   map[string]*template.Template
	secret  []byte
	limiter *rateLimiter
	metrics *Metrics
	static  http.Handler
}

// New builds a Server.
func New(cfg *config.Config, st *store.Store, logger *slog.Logger) (*Server, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: cfg.RPDisplayName,
		RPOrigins:     cfg.RPOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("configure webauthn: %w", err)
	}
	secret := []byte(cfg.SessionSecret)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, err
		}
		logger.Warn("SESSION_SECRET not set; generated an ephemeral key (open forms stop validating after a restart)")
	}
	pages, err := parseTemplates()
	if err != nil {
		return nil, err
	}
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		return nil, err
	}
	s := &Server{
		cfg: cfg, store: st, wa: wa, log: logger, pages: pages, secret: secret,
		limiter: newRateLimiter(30, 3*time.Second),
		metrics: NewMetrics(),
		static:  staticHandler(sub),
	}
	return s, nil
}

// Metrics exposes the Prometheus registry for the metrics server.
func (s *Server) Metrics() *Metrics { return s.metrics }

// ---- routing ----

// Handler returns the full HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /static/", s.static)
	mux.HandleFunc("GET /healthz", s.healthz)

	// Public pages.
	mux.HandleFunc("GET /{$}", s.optional(s.home))
	mux.HandleFunc("GET /login", s.optional(s.loginPage))
	mux.HandleFunc("GET /signup", s.optional(s.signupPage))
	mux.HandleFunc("GET /recover", s.optional(s.recoverPage))
	mux.HandleFunc("POST /recover", s.optional(s.recoverSubmit))
	mux.HandleFunc("GET /recover/link", s.optional(s.recoverLinkPage))
	mux.HandleFunc("POST /recover/link", s.optional(s.recoverLinkSubmit))

	// Passkey ceremonies.
	mux.HandleFunc("POST /auth/signup/begin", s.limited(s.signupBegin))
	mux.HandleFunc("POST /auth/signup/finish", s.limited(s.signupFinish))
	mux.HandleFunc("POST /auth/login/begin", s.limited(s.loginBegin))
	mux.HandleFunc("POST /auth/login/finish", s.limited(s.loginFinish))
	mux.HandleFunc("POST /auth/logout", s.authed(s.logout))
	mux.HandleFunc("GET /auth/stepup", s.authed(s.stepupPage))
	mux.HandleFunc("POST /auth/stepup/begin", s.limited(s.authed(s.stepupBegin)))
	mux.HandleFunc("POST /auth/stepup/finish", s.limited(s.authed(s.stepupFinish)))

	// Game.
	mux.HandleFunc("POST /play", s.authed(s.play))
	mux.HandleFunc("GET /games/{id}", s.authed(s.gamePage))
	mux.HandleFunc("POST /games/{id}/moves", s.authed(s.postMove))
	mux.HandleFunc("GET /games/{id}/replay", s.authed(s.replayPage))
	mux.HandleFunc("GET /days", s.authed(s.daysPage))
	mux.HandleFunc("GET /days/{date}", s.authed(s.dayBoard))
	mux.HandleFunc("GET /history", s.authed(s.historyPage))
	mux.HandleFunc("GET /history/stats", s.authed(s.statsFrame))

	// Account.
	mux.HandleFunc("GET /account", s.authed(s.accountPage))
	mux.HandleFunc("POST /account/profile", s.authed(s.updateProfile))
	mux.HandleFunc("POST /account/passkeys/begin", s.limited(s.authed(s.addPasskeyBegin)))
	mux.HandleFunc("POST /account/passkeys/finish", s.limited(s.authed(s.addPasskeyFinish)))
	mux.HandleFunc("POST /account/passkeys/{id}/rename", s.authed(s.renamePasskey))
	mux.HandleFunc("POST /account/passkeys/{id}/revoke", s.authed(s.revokePasskey))
	mux.HandleFunc("POST /account/sessions/{id}/revoke", s.authed(s.revokeSession))
	mux.HandleFunc("POST /account/sessions/revoke-all", s.authed(s.revokeAllSessions))
	mux.HandleFunc("POST /account/recovery-codes", s.authed(s.newRecoveryCodes))
	mux.HandleFunc("GET /account/export", s.authed(s.exportArchive))
	mux.HandleFunc("GET /account/delete", s.authed(s.deletePage))
	mux.HandleFunc("POST /account/delete", s.authed(s.deleteAccount))

	cop := http.NewCrossOriginProtection()
	for _, o := range s.cfg.RPOrigins {
		_ = cop.AddTrustedOrigin(o)
	}
	return s.recoverer(s.logRequests(s.secure(cop.Handler(mux))))
}

// ---- middleware ----

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxSession
	ctxNonce
)

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "path", r.URL.Path, "panic", fmt.Sprint(v))
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		s.metrics.Request(sw.status)
		s.log.Info("request",
			"method", r.Method, "path", r.URL.Path, "status", sw.status,
			"duration_ms", time.Since(start).Milliseconds())
	})
}

// secure sets security headers and a per-request CSP nonce for the importmap.
func (s *Server) secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce := randomString(16)
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; "+
			"style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "+
			"base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		if s.cfg.Secure() {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxNonce, nonce)))
	})
}

func randomString(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// optional loads the session if there is one and never rejects.
func (s *Server) optional(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		next(w, s.withSession(w, r))
	}
}

// authed requires a signed-in user and, for unsafe methods, a valid CSRF token.
func (s *Server) authed(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r = s.withSession(w, r)
		if user(r) == nil {
			if r.Method == http.MethodGet || r.Method == http.MethodHead {
				http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
				return
			}
			if wantsJSON(r) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "signin"})
				return
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.validCSRF(r) {
			s.fail(w, r, http.StatusForbidden, "Your form expired. Go back and try again.")
			return
		}
		next(w, r)
	}
}

func (s *Server) limited(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.allow(s.clientIP(r)) {
			w.Header().Set("Retry-After", "3")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "Too many attempts. Wait a moment and try again."})
			return
		}
		next(w, r)
	}
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			first, _, _ := strings.Cut(xff, ",")
			return strings.TrimSpace(first)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) cookieName() string {
	if s.cfg.Secure() {
		return "__Host-session"
	}
	return "session"
}

func (s *Server) withSession(w http.ResponseWriter, r *http.Request) *http.Request {
	c, err := r.Cookie(s.cookieName())
	if err != nil || c.Value == "" {
		return r
	}
	sess, u, err := s.store.SessionByToken(r.Context(), c.Value)
	if err != nil {
		s.clearCookie(w)
		return r
	}
	s.store.TouchSession(r.Context(), sess)
	ctx := context.WithValue(r.Context(), ctxUser, u)
	ctx = context.WithValue(ctx, ctxSession, sess)
	return r.WithContext(ctx)
}

func user(r *http.Request) *store.User {
	u, _ := r.Context().Value(ctxUser).(*store.User)
	return u
}

func session(r *http.Request) *store.Session {
	x, _ := r.Context().Value(ctxSession).(*store.Session)
	return x
}

func nonce(r *http.Request) string {
	n, _ := r.Context().Value(ctxNonce).(string)
	return n
}

func (s *Server) setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName(), Value: token, Path: "/", HttpOnly: true,
		Secure: s.cfg.Secure(), SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds()),
	})
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName(), Value: "", Path: "/", HttpOnly: true,
		Secure: s.cfg.Secure(), SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
}

// ---- CSRF ----

func (s *Server) csrfToken(sess *store.Session) string {
	if sess == nil {
		return ""
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("csrf:" + sess.ID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) validCSRF(r *http.Request) bool {
	got := r.Header.Get("X-CSRF-Token")
	if got == "" {
		got = r.PostFormValue("csrf")
	}
	want := s.csrfToken(session(r))
	return want != "" && hmac.Equal([]byte(got), []byte(want))
}

// ---- helpers ----

func wantsJSON(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Content-Type"), "application/json") ||
		strings.Contains(r.Header.Get("Accept"), "application/json")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<16)).Decode(v)
}

// safeNext only allows same-site relative paths as post-login destinations.
func safeNext(next string) string {
	if next == "" || next[0] != '/' || strings.HasPrefix(next, "//") || strings.ContainsAny(next, "\\\r\n") {
		return "/"
	}
	return next
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "date": dates.Today(time.Now())})
}

func (s *Server) setFlash(w http.ResponseWriter, msg string) {
	http.SetCookie(w, &http.Cookie{Name: "flash", Value: base64.RawURLEncoding.EncodeToString([]byte(msg)),
		Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 60, Secure: s.cfg.Secure()})
}

func (s *Server) takeFlash(w http.ResponseWriter, r *http.Request) string {
	c, err := r.Cookie("flash")
	if err != nil {
		return ""
	}
	http.SetCookie(w, &http.Cookie{Name: "flash", Value: "", Path: "/", MaxAge: -1})
	b, _ := base64.RawURLEncoding.DecodeString(c.Value)
	return string(b)
}
