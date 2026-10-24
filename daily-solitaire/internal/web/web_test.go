package web

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/descope/virtualwebauthn"

	"daily-solitaire/internal/config"
	"daily-solitaire/internal/klondike"
	"daily-solitaire/internal/store"
)

const testOrigin = "http://localhost:8080"

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	now   *time.Time
	rp    virtualwebauthn.RelyingParty
	cfg   *config.Config
	seed  uint64
	moves []klondike.Move
}

// newEnv starts a real HTTP server on a temp database, with a fixed clock at
// 2026-10-24 12:00 PDT and one proven-winnable seed (from the golden fixtures)
// in the pool, so a whole game can be played through HTTP.
func newEnv(t *testing.T, mutate ...func(*config.Config)) *env {
	t.Helper()
	cfg := &config.Config{
		RPID: "localhost", RPDisplayName: "Daily Solitaire", RPOrigins: []string{testOrigin},
		Signups: "open", BaseURL: testOrigin, SessionSecret: "test-secret",
	}
	for _, m := range mutate {
		m(cfg)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 24, 19, 0, 0, 0, time.UTC)
	st.SetClock(func() time.Time { return now })
	t.Cleanup(func() { st.Close() })

	f, err := os.Open("../klondike/testdata/golden.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	sc.Scan()
	var fx struct{ Seed, Moves string }
	if err := json.Unmarshal(sc.Bytes(), &fx); err != nil {
		t.Fatal(err)
	}
	seed, _ := klondike.ParseSeed(fx.Seed)
	moves, err := klondike.ParseMoves(fx.Moves)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.LoadSeeds(t.Context(), map[uint64]string{seed: fx.Moves}); err != nil {
		t.Fatal(err)
	}

	srv, err := New(cfg, st, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return &env{t: t, st: st, srv: ts, now: &now, cfg: cfg, seed: seed, moves: moves,
		rp: virtualwebauthn.RelyingParty{Name: "Daily Solitaire", ID: "localhost", Origin: testOrigin}}
}

// browser is a cookie-carrying client that never follows redirects, plus a
// virtual authenticator.
type browser struct {
	e    *env
	c    *http.Client
	auth virtualwebauthn.Authenticator
	cred virtualwebauthn.Credential
}

func (e *env) newBrowser() *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{
		e:    e,
		c:    &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		auth: virtualwebauthn.NewAuthenticator(),
		cred: virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2),
	}
}

func (b *browser) do(method, path string, body io.Reader, headers map[string]string) (int, string, http.Header) {
	b.e.t.Helper()
	req, _ := http.NewRequest(method, b.e.srv.URL+path, body)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15")
	resp, err := b.c.Do(req)
	if err != nil {
		b.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out), resp.Header
}

func (b *browser) get(path string) (int, string, http.Header) { return b.do("GET", path, nil, nil) }

func (b *browser) postForm(path string, v url.Values) (int, string, http.Header) {
	return b.do("POST", path, strings.NewReader(v.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
}

func (b *browser) postJSON(path string, v any, csrf string) (int, map[string]json.RawMessage) {
	raw, _ := json.Marshal(v)
	h := map[string]string{"Content-Type": "application/json"}
	if csrf != "" {
		h["X-CSRF-Token"] = csrf
	}
	code, body, _ := b.do("POST", path, bytes.NewReader(raw), h)
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(body), &out)
	return code, out
}

func (b *browser) postRaw(path, body, csrf string) (int, map[string]json.RawMessage) {
	h := map[string]string{"Content-Type": "application/json"}
	if csrf != "" {
		h["X-CSRF-Token"] = csrf
	}
	code, resp, _ := b.do("POST", path, strings.NewReader(body), h)
	var out map[string]json.RawMessage
	_ = json.Unmarshal([]byte(resp), &out)
	return code, out
}

var csrfRE = regexp.MustCompile(`<meta name="csrf-token" content="([^"]*)"`)

func (b *browser) csrf() string {
	_, body, _ := b.get("/account")
	m := csrfRE.FindStringSubmatch(body)
	if m == nil {
		b.e.t.Fatal("no csrf token on /account; not signed in?")
	}
	return m[1]
}

func str(raw json.RawMessage) string {
	var s string
	_ = json.Unmarshal(raw, &s)
	return s
}

func (b *browser) signup(username string) {
	b.e.t.Helper()
	code, out := b.postJSON("/auth/signup/begin", map[string]string{"username": username, "display_name": strings.ToUpper(username[:1]) + username[1:]}, "")
	if code != 200 {
		b.e.t.Fatalf("signup begin: %d %s", code, out["error"])
	}
	opts, err := virtualwebauthn.ParseAttestationOptions(string(out["options"]))
	if err != nil {
		b.e.t.Fatal(err)
	}
	resp := virtualwebauthn.CreateAttestationResponse(b.e.rp, b.auth, b.cred, *opts)
	code, fin := b.postRaw("/auth/signup/finish?c="+url.QueryEscape(str(out["c"])), resp, "")
	if code != 200 {
		b.e.t.Fatalf("signup finish: %d %s", code, fin["error"])
	}
	b.auth.AddCredential(b.cred)
	u, err := b.e.st.UserByUsername(b.e.t.Context(), username)
	if err != nil {
		b.e.t.Fatal(err)
	}
	b.auth.Options.UserHandle = []byte(u.ID)
}

// assertion runs a login or step-up ceremony and returns the finish response.
func (b *browser) assertion(beginPath, finishPath string, req any, csrf string) (int, map[string]json.RawMessage) {
	return b.assertion2(beginPath, finishPath, req, csrf)
}

func (b *browser) assertion2(beginPath, finishPath string, req any, csrf string) (int, map[string]json.RawMessage) {
	b.e.t.Helper()
	code, out := b.postJSON(beginPath, req, csrf)
	if code != 200 {
		b.e.t.Fatalf("%s: %d %s", beginPath, code, out["error"])
	}
	opts, err := virtualwebauthn.ParseAssertionOptions(string(out["options"]))
	if err != nil {
		b.e.t.Fatal(err)
	}
	b.cred.Counter++ // a real authenticator's signature counter moves on every use
	resp := virtualwebauthn.CreateAssertionResponse(b.e.rp, b.auth, b.cred, *opts)
	sep := "?c="
	extra := ""
	if str(out["mode"]) == "user" {
		extra = "&mode=user"
	}
	return b.postRaw(finishPath+sep+url.QueryEscape(str(out["c"]))+extra, resp, csrf)
}

func (b *browser) login() {
	b.e.t.Helper()
	code, out := b.assertion("/auth/login/begin", "/auth/login/finish", map[string]string{}, "")
	if code != 200 {
		b.e.t.Fatalf("login finish: %d %s", code, out["error"])
	}
}

var gameRE = regexp.MustCompile(`/games/([0-9A-Z]{26})`)

func TestSignupPlayWinAndBoard(t *testing.T) {
	e := newEnv(t)
	ann := e.newBrowser()

	if code, body, _ := ann.get("/"); code != 200 || !strings.Contains(body, "Sign in to play") {
		t.Fatalf("anonymous home: %d", code)
	}
	if code, _, hdr := ann.get("/days"); code != 303 || !strings.HasPrefix(hdr.Get("Location"), "/login") {
		t.Fatalf("days should require sign-in: %d %s", code, hdr.Get("Location"))
	}

	ann.signup("ann")
	csrf := ann.csrf()

	// Starting the game mints today's deal from the pool.
	code, _, hdr := ann.postForm("/play", url.Values{"csrf": {csrf}, "date": {"2026-10-24"}})
	if code != 303 {
		t.Fatalf("play: %d", code)
	}
	gameURL := hdr.Get("Location")
	id := gameRE.FindStringSubmatch(gameURL)[1]
	game, _ := e.st.Game(t.Context(), id)
	if game.Seed != e.seed {
		t.Fatalf("deal seed %x, want the pooled %x", game.Seed, e.seed)
	}

	move := func(v url.Values) {
		t.Helper()
		v.Set("csrf", csrf)
		code, _, hdr := ann.postForm("/games/"+id+"/moves", v)
		if code != 303 || hdr.Get("Location") != "/games/"+id {
			t.Fatalf("move %v: %d -> %s", v, code, hdr.Get("Location"))
		}
	}
	seq := func() string {
		n, _ := e.st.Moves(t.Context(), id)
		return strconv.Itoa(len(n))
	}

	// The board never reveals face-down or stock cards.
	_, page, _ := ann.get(gameURL)
	st0, _ := klondike.New(e.seed, klondike.DefaultRuleset())
	for _, c := range st0.Stock {
		if strings.Contains(page, `id="c`+strconv.Itoa(int(c))+`"`) {
			t.Fatalf("page leaks stock card %s", c)
		}
	}
	for t7 := 0; t7 < 7; t7++ {
		for _, c := range st0.Tab[t7].Cards[:st0.Tab[t7].Down] {
			if strings.Contains(page, `id="c`+strconv.Itoa(int(c))+`"`) {
				t.Fatalf("page leaks face-down card %s", c)
			}
		}
	}

	// A stale seq and an illegal move both redirect without writing anything.
	move(url.Values{"type": {"draw"}, "seq": {"7"}})
	move(url.Values{"card": {"0"}, "to": {"f3"}, "seq": {"0"}})
	if seq() != "0" {
		t.Fatalf("rejected moves were recorded")
	}
	// Missing CSRF is refused outright.
	if code, _, _ := ann.postForm("/games/"+id+"/moves", url.Values{"type": {"draw"}, "seq": {"0"}}); code != 403 {
		t.Fatalf("no csrf token: %d", code)
	}

	// Play the solver's proof through the real endpoint.
	for _, m := range e.moves {
		switch m.Type {
		case klondike.TypeDraw, klondike.TypeRecycle:
			move(url.Values{"type": {string(m.Type)}, "seq": {seq()}})
		case klondike.TypeMove:
			move(url.Values{"card": {strconv.Itoa(int(m.Cards[0]))}, "to": {string(m.To)}, "seq": {seq()}})
		case klondike.TypeAuto:
			move(url.Values{"type": {"auto"}, "seq": {seq()}})
			goto done
		}
	}
done:
	final, _ := e.st.Game(t.Context(), id)
	if final.Result != store.ResultWon {
		t.Fatalf("result %q after playing the proof (moves=%d)", final.Result, final.MoveCount)
	}
	// Moves after the win are ignored.
	move(url.Values{"type": {"draw"}, "seq": {seq()}})

	_, page, _ = ann.get(gameURL)
	if !strings.Contains(page, "Won") || !strings.Contains(page, "timeline") {
		t.Fatalf("finished page missing result/timeline")
	}
	if code, body, _ := ann.get("/days/2026-10-24"); code != 200 || !strings.Contains(body, "Ann") {
		t.Fatalf("board: %d", code)
	}
	if code, body, _ := ann.get("/games/" + id + "/replay?step=3"); code != 200 || !strings.Contains(body, "3 / ") {
		t.Fatalf("replay: %d", code)
	}
}

func TestBoardHiddenUntilFinishedAndGamesArePrivate(t *testing.T) {
	e := newEnv(t)
	ann, bob := e.newBrowser(), e.newBrowser()
	ann.signup("ann")
	bob.signup("bob")
	annCSRF, bobCSRF := ann.csrf(), bob.csrf()

	_, _, hdr := ann.postForm("/play", url.Values{"csrf": {annCSRF}, "date": {"2026-10-24"}})
	annGame := hdr.Get("Location")

	// Bob can't open Ann's game, replay or move for her.
	if code, _, _ := bob.get(annGame); code != 404 {
		t.Fatalf("other player's game: %d", code)
	}
	if code, _, _ := bob.postForm(annGame+"/moves", url.Values{"csrf": {bobCSRF}, "type": {"draw"}, "seq": {"0"}}); code != 404 {
		t.Fatalf("other player's move: %d", code)
	}
	// Bob hasn't played, so the board stays hidden.
	if _, body, _ := bob.get("/days/2026-10-24"); !strings.Contains(body, "stays hidden") {
		t.Fatal("board visible before playing")
	}
	// Bob started but unfinished: still hidden.
	_, _, hdr = bob.postForm("/play", url.Values{"csrf": {bobCSRF}, "date": {"2026-10-24"}})
	bobGame := hdr.Get("Location")
	if _, body, _ := bob.get("/days/2026-10-24"); !strings.Contains(body, "stays hidden") {
		t.Fatal("board visible mid-game")
	}
	// Everyone plays the same deal, and Bob can only play it once.
	ga, _ := e.st.GameForDate(t.Context(), mustUser(t, e, "ann"), "2026-10-24")
	gb, _ := e.st.GameForDate(t.Context(), mustUser(t, e, "bob"), "2026-10-24")
	if ga.Seed != gb.Seed {
		t.Fatal("different deals for the same day")
	}
	if _, _, hdr = bob.postForm("/play", url.Values{"csrf": {bobCSRF}, "date": {"2026-10-24"}}); hdr.Get("Location") != bobGame {
		t.Fatal("a second play created a second game")
	}
	// Resigning finishes the game and unlocks the board.
	bob.postForm(bobGame+"/moves", url.Values{"csrf": {bobCSRF}, "type": {"resign"}, "seq": {"0"}})
	if _, body, _ := bob.get("/days/2026-10-24"); !strings.Contains(body, "Resigned") {
		t.Fatalf("board should unlock after finishing:\n%s", body)
	}
	// Dates outside the window don't exist.
	for _, d := range []string{"2026-09-30", "2026-10-25", "nope"} {
		if code, _, _ := bob.get("/days/" + d); code != 404 {
			t.Fatalf("/days/%s: %d", d, code)
		}
	}
}

func mustUser(t *testing.T, e *env, name string) string {
	t.Helper()
	u, err := e.st.UserByUsername(t.Context(), name)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func TestGraceWindowClosesGameAsLoss(t *testing.T) {
	e := newEnv(t)
	ann := e.newBrowser()
	ann.signup("ann")
	csrf := ann.csrf()
	_, _, hdr := ann.postForm("/play", url.Values{"csrf": {csrf}, "date": {"2026-10-24"}})
	game := hdr.Get("Location")

	// 02:30 PDT the next morning: still playable.
	*e.now = time.Date(2026, 10, 25, 9, 30, 0, 0, time.UTC)
	ann.postForm(game+"/moves", url.Values{"csrf": {csrf}, "type": {"draw"}, "seq": {"0"}})
	if n, _ := e.st.Moves(t.Context(), mustGame(t, e, game)); len(n) != 1 {
		t.Fatalf("move inside the grace window was refused")
	}
	// 03:01 PDT: closed.
	*e.now = time.Date(2026, 10, 25, 10, 1, 0, 0, time.UTC)
	// The session must outlive the clock jump.
	ann.login()
	csrf = ann.csrf()
	ann.postForm(game+"/moves", url.Values{"csrf": {csrf}, "type": {"draw"}, "seq": {"1"}})
	if n, _ := e.st.Moves(t.Context(), mustGame(t, e, game)); len(n) != 1 {
		t.Fatalf("move after the deadline was accepted")
	}
	if _, body, _ := ann.get(game); !strings.Contains(body, "Out of time") {
		t.Fatal("expired game not shown as a loss")
	}
}

func mustGame(t *testing.T, e *env, path string) string {
	t.Helper()
	return gameRE.FindStringSubmatch(path)[1]
}

func TestLoginStepUpExportAndDelete(t *testing.T) {
	e := newEnv(t)
	ann := e.newBrowser()
	ann.signup("ann")

	// A new browser signs in with the discoverable passkey (no username).
	phone := &browser{e: e, c: e.newBrowser().c, auth: ann.auth, cred: ann.cred}
	phone.login()
	csrf := phone.csrf()

	// Fresh right after signing in: export works.
	code, body, hdr := phone.get("/account/export")
	if code != 200 || !strings.Contains(hdr.Get("Content-Disposition"), "attachment") {
		t.Fatalf("export: %d", code)
	}
	var archive store.Archive
	if err := json.Unmarshal([]byte(body), &archive); err != nil || archive.Format != "daily-solitaire-archive" || archive.Version != 1 {
		t.Fatalf("archive: %v %s", err, body)
	}

	// Ten minutes later the session is no longer fresh: step-up first.
	*e.now = e.now.Add(10 * time.Minute)
	if code, _, hdr = phone.get("/account/export"); code != 303 || !strings.HasPrefix(hdr.Get("Location"), "/auth/stepup") {
		t.Fatalf("stale export: %d %s", code, hdr.Get("Location"))
	}
	if code, _, hdr = phone.get("/account/delete"); code != 303 {
		t.Fatalf("stale delete page: %d", code)
	}
	if code, _ := phone.postJSON("/account/passkeys/begin", map[string]string{}, csrf); code != 403 {
		t.Fatalf("stale add-passkey: %d", code)
	}
	if code, out := phone.assertion("/auth/stepup/begin", "/auth/stepup/finish", map[string]string{}, csrf); code != 200 {
		t.Fatalf("stepup: %d %s", code, out["error"])
	}
	if code, _, _ = phone.get("/account/export"); code != 200 {
		t.Fatalf("export after step-up: %d", code)
	}

	// Add a second passkey, then the first can be revoked; the last cannot.
	code, out := phone.postJSON("/account/passkeys/begin", map[string]string{"name": "Laptop"}, csrf)
	if code != 200 {
		t.Fatalf("add begin: %d %s", code, out["error"])
	}
	second := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	opts, _ := virtualwebauthn.ParseAttestationOptions(string(out["options"]))
	resp := virtualwebauthn.CreateAttestationResponse(e.rp, phone.auth, second, *opts)
	if code, out = phone.postRaw("/account/passkeys/finish?c="+url.QueryEscape(str(out["c"])), resp, csrf); code != 200 {
		t.Fatalf("add finish: %d %s", code, out["error"])
	}
	creds, _ := e.st.CredentialsForUser(t.Context(), mustUser(t, e, "ann"))
	if len(creds) != 2 || creds[1].Name != "Laptop" {
		t.Fatalf("credentials: %+v", creds)
	}
	phone.postForm("/account/passkeys/"+creds[0].ID+"/revoke", url.Values{"csrf": {csrf}})
	phone.postForm("/account/passkeys/"+creds[1].ID+"/revoke", url.Values{"csrf": {csrf}})
	if left, _ := e.st.CredentialsForUser(t.Context(), mustUser(t, e, "ann")); len(left) != 1 {
		t.Fatalf("expected exactly one passkey to remain, have %d", len(left))
	}

	// Recovery codes sign in once.
	_, page, _ := func() (int, string, http.Header) {
		return phone.postForm("/account/recovery-codes", url.Values{"csrf": {csrf}})
	}()
	code0 := regexp.MustCompile(`<code>([A-Z0-9-]+)</code>`).FindStringSubmatch(page)
	if code0 == nil {
		t.Fatalf("no recovery codes shown:\n%s", page)
	}
	rescue := e.newBrowser()
	if code, _, hdr = rescue.postForm("/recover", url.Values{"code": {code0[1]}}); code != 303 || hdr.Get("Location") != "/account#passkeys" {
		t.Fatalf("recovery sign-in: %d", code)
	}
	if code, _, _ = e.newBrowser().postForm("/recover", url.Values{"code": {code0[1]}}); code != 401 {
		t.Fatalf("recovery code reused: %d", code)
	}

	// The revoked passkey is now unknown: a sign-in attempt with it says so, so
	// the browser can signal it away (WebAuthn Signals).
	{
		stranger := e.newBrowser()
		stranger.auth, stranger.cred = phone.auth, phone.cred
		code, out := stranger.assertion2("/auth/login/begin", "/auth/login/finish", map[string]string{}, "")
		if code != 401 || string(out["unknown_credential"]) != "true" {
			t.Fatalf("revoked passkey: %d %s", code, out)
		}
	}
	phone.cred = second
	phone.auth.AddCredential(second)

	// Sessions list shows devices; sign-out-everywhere ends them.
	if _, body, _ := phone.get("/account"); !strings.Contains(body, "Safari on macOS") || !strings.Contains(body, "Security log") {
		t.Fatal("account page missing device or log")
	}
	phone.postForm("/account/sessions/revoke-all", url.Values{"csrf": {csrf}})
	if code, _, _ = phone.get("/account"); code != 303 {
		t.Fatalf("session survived sign-out-everywhere: %d", code)
	}

	// Delete the account (needs a fresh session and the typed username).
	phone.login()
	csrf = phone.csrf()
	phone.postForm("/account/delete", url.Values{"csrf": {csrf}, "confirm": {"wrong"}})
	if _, err := e.st.UserByUsername(t.Context(), "ann"); err != nil {
		t.Fatal("account deleted without confirmation")
	}
	phone.postForm("/account/delete", url.Values{"csrf": {csrf}, "confirm": {"ann"}})
	if _, err := e.st.UserByUsername(t.Context(), "ann"); err == nil {
		t.Fatal("account not deleted")
	}
}

func TestClosedSignupsAndDisabledUsers(t *testing.T) {
	e := newEnv(t, func(c *config.Config) { c.Signups = "closed" })
	b := e.newBrowser()
	if code, out := b.postJSON("/auth/signup/begin", map[string]string{"username": "eve"}, ""); code != 403 {
		t.Fatalf("closed signups allowed: %d %s", code, out["error"])
	}
	// The admin path: create the account, sign in with a one-time link.
	u, _ := e.st.CreateUser(t.Context(), "dana", "Dana")
	link, _ := e.st.NewRecoveryLink(t.Context(), u.ID, time.Hour)
	if code, body, _ := b.get("/recover/link?token=" + link); code != 200 || !strings.Contains(body, "Continue") {
		t.Fatalf("link page: %d", code)
	}
	if code, _, hdr := b.postForm("/recover/link", url.Values{"token": {link}}); code != 303 || hdr.Get("Location") != "/account#passkeys" {
		t.Fatalf("link sign-in: %d", code)
	}
	if code, _, _ := e.newBrowser().postForm("/recover/link", url.Values{"token": {link}}); code != 401 {
		t.Fatalf("link reused: %d", code)
	}
	// Recovery sessions are fresh, so Dana can enrol her first passkey right away.
	csrf := b.csrf()
	if code, out := b.postJSON("/account/passkeys/begin", map[string]string{}, csrf); code != 200 {
		t.Fatalf("first passkey after recovery: %d %s", code, out["error"])
	}
	// Disabled accounts lose their sessions.
	if err := e.st.SetDisabled(t.Context(), u.ID, true); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := b.get("/account"); code != 303 {
		t.Fatalf("disabled user still signed in: %d", code)
	}
}

func TestOpenRedirectAndHeaders(t *testing.T) {
	for in, want := range map[string]string{
		"/days": "/days", "//evil.com": "/", "https://evil.com": "/", "/\\evil.com": "/", "": "/", "/a?b=c": "/a?b=c",
	} {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
	e := newEnv(t)
	b := e.newBrowser()
	_, _, hdr := b.get("/login")
	csp := hdr.Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' 'nonce-") || hdr.Get("X-Frame-Options") != "DENY" {
		t.Fatalf("security headers: %q", csp)
	}
	if code, body, _ := b.get("/healthz"); code != 200 || !strings.Contains(body, `"ok"`) {
		t.Fatalf("healthz: %d %s", code, body)
	}
	// Cross-origin POSTs from a browser are rejected before reaching handlers.
	req, _ := http.NewRequest("POST", e.srv.URL+"/auth/login/begin", strings.NewReader("{}"))
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-site POST: %d", resp.StatusCode)
	}
}

func TestRateLimiter(t *testing.T) {
	l := newRateLimiter(3, time.Hour)
	for i := 0; i < 3; i++ {
		if !l.allow("ip") {
			t.Fatalf("request %d refused inside burst", i)
		}
	}
	if l.allow("ip") {
		t.Fatal("burst exceeded")
	}
	if !l.allow("other") {
		t.Fatal("limits must be per key")
	}
}

func TestStatic(t *testing.T) {
	e := newEnv(t)
	b := e.newBrowser()
	for _, p := range []string{"/static/app.css", "/static/app.js", "/static/vendor/turbo.js", "/static/vendor/stimulus.js", "/static/favicon.svg"} {
		code, body, hdr := b.get(p)
		if code != 200 || len(body) < 100 || hdr.Get("ETag") == "" {
			t.Fatalf("%s: %d len=%d", p, code, len(body))
		}
		req, _ := http.NewRequest("GET", e.srv.URL+p, nil)
		req.Header.Set("If-None-Match", hdr.Get("ETag"))
		resp, _ := http.DefaultClient.Do(req)
		resp.Body.Close()
		if resp.StatusCode != 304 {
			t.Fatalf("%s revalidation: %d", p, resp.StatusCode)
		}
	}
}
