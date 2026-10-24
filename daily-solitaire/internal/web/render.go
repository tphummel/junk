package web

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"daily-solitaire/internal/dates"
	"daily-solitaire/internal/store"
)

// Page is the data every full-page template receives.
type Page struct {
	Title   string
	Path    string
	User    *store.User
	CSRF    string
	Nonce   string
	Flash   string
	Deck    string
	Signups bool
	RPID    string
	Data    any
}

var funcs = template.FuncMap{
	"dict": func(kv ...any) map[string]any {
		m := make(map[string]any, len(kv)/2)
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i].(string)] = kv[i+1]
		}
		return m
	},
	"niceDate": func(date string) string {
		t, err := dates.Parse(date)
		if err != nil {
			return date
		}
		return t.Format("Monday, January 2")
	},
	"shortDate": func(date string) string {
		t, err := dates.Parse(date)
		if err != nil {
			return date
		}
		return t.Format("Jan 2")
	},
	"clock": func(t time.Time) string { return t.In(dates.Pacific).Format("Jan 2, 3:04 pm MST") },
	"dur":   formatDuration,
	"durPtr": func(ms *int64) string {
		if ms == nil {
			return "–"
		}
		return formatDuration(*ms)
	},
	"ago":         ago,
	"pct":         func(f float64) string { return fmt.Sprintf("%.0f%%", f) },
	"f1":          func(f float64) string { return fmt.Sprintf("%.1f", f) },
	"add":         func(a, b int) int { return a + b },
	"sub":         func(a, b int) int { return a - b },
	"resultLabel": resultLabel,
	"avatar":      avatarSVG,
	"json":        func(v any) string { b, _ := json.Marshal(v); return string(b) },
	"deref":       func(t *time.Time) time.Time { return *t },
	"seq": func(n int) []int {
		out := make([]int, n)
		for i := range out {
			out[i] = i
		}
		return out
	},
	"aaguidName": aaguidName,
	"device":     deviceName,
	"eventLabel": eventLabel,
}

func formatDuration(ms int64) string {
	d := time.Duration(ms) * time.Millisecond
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm %02ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh %02dm", int(d.Hours()), int(d.Minutes())%60)
}

func ago(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d min ago", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%d h ago", int(d.Hours()))
	}
	return t.In(dates.Pacific).Format("Jan 2, 2006")
}

func resultLabel(r string) string {
	switch r {
	case store.ResultWon:
		return "Won"
	case store.ResultResigned:
		return "Resigned"
	case store.ResultExpired:
		return "Out of time"
	}
	return "In progress"
}

func parseTemplates() (map[string]*template.Template, error) {
	entries, err := fs.ReadDir(templatesFS, "templates")
	if err != nil {
		return nil, err
	}
	shared := []string{"templates/layout.html", "templates/board.html"}
	pages := map[string]*template.Template{}
	for _, e := range entries {
		name := e.Name()
		if name == "layout.html" || name == "board.html" {
			continue
		}
		files := append(append([]string{}, shared...), "templates/"+name)
		t, err := template.New(name).Funcs(funcs).ParseFS(templatesFS, files...)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", name, err)
		}
		pages[strings.TrimSuffix(name, ".html")] = t
	}
	return pages, nil
}

// render writes a full page.
func (s *Server) render(w http.ResponseWriter, r *http.Request, status int, name, title string, data any) {
	t, ok := s.pages[name]
	if !ok {
		s.log.Error("missing template", "name", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	u := user(r)
	p := Page{
		Title: title, Path: r.URL.Path, User: u, CSRF: s.csrfToken(session(r)), Nonce: nonce(r),
		Flash: s.takeFlash(w, r), Deck: "paper", Signups: s.cfg.SignupsOpen(), RPID: s.cfg.RPID, Data: data,
	}
	if u != nil {
		p.Deck = u.Deck
	}
	var buf bytes.Buffer
	if err := t.ExecuteTemplate(&buf, name+".html", p); err != nil {
		s.log.Error("render", "name", name, "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

// fail renders a friendly error page.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, status int, msg string) {
	s.render(w, r, status, "error", http.StatusText(status), msg)
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	s.fail(w, r, http.StatusNotFound, "That page doesn't exist, or it isn't yours to see.")
}

// ---- static assets ----

type staticFile struct {
	body        []byte
	etag        string
	contentType string
}

// staticHandler serves embedded assets with ETags (revalidated on every load,
// so a deploy is picked up immediately and there is no build step).
func staticHandler(root fs.FS) http.Handler {
	files := map[string]staticFile{}
	_ = fs.WalkDir(root, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		body, err := fs.ReadFile(root, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(body)
		ct := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".js":
			ct = "text/javascript; charset=utf-8"
		case ".css":
			ct = "text/css; charset=utf-8"
		case ".svg":
			ct = "image/svg+xml"
		}
		files["/static/"+p] = staticFile{body: body, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, contentType: ct}
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("ETag", f.etag)
		w.Header().Set("Cache-Control", "no-cache")
		if r.Header.Get("If-None-Match") == f.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", f.contentType)
		_, _ = w.Write(f.body)
	})
}

// ---- rate limiting ----

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu       sync.Mutex
	burst    float64
	interval time.Duration
	buckets  map[string]*bucket
	lastGC   time.Time
}

// newRateLimiter allows a burst of n requests per key, refilling one request
// every interval.
func newRateLimiter(burst int, interval time.Duration) *rateLimiter {
	return &rateLimiter{burst: float64(burst), interval: interval, buckets: map[string]*bucket{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.lastGC) > 10*time.Minute {
		for k, b := range l.buckets {
			if now.Sub(b.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
		l.lastGC = now
	}
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = min(l.burst, b.tokens+float64(now.Sub(b.last))/float64(l.interval))
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
