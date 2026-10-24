package web

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"daily-solitaire/internal/dates"
	"daily-solitaire/internal/klondike"
	"daily-solitaire/internal/store"
)

type homeData struct {
	Today    string
	Game     *store.Game
	Stats    store.Stats
	HasStats bool
}

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	data := homeData{Today: dates.Today(s.store.Now())}
	if u := user(r); u != nil {
		_, _ = s.store.ExpireGames(r.Context())
		if g, err := s.store.GameForDate(r.Context(), u.ID, data.Today); err == nil {
			data.Game = g
		}
		if st, err := s.store.StatsFor(r.Context(), u.ID); err == nil && st.Played > 0 {
			data.Stats, data.HasStats = st, true
		}
	}
	s.render(w, r, http.StatusOK, "home", "Today's deal", data)
}

// play starts (or resumes) the signed-in user's game for a date.
func (s *Server) play(w http.ResponseWriter, r *http.Request) {
	u := user(r)
	date := r.PostFormValue("date")
	if date == "" {
		date = dates.Today(s.store.Now())
	}
	g, err := s.store.StartGame(r.Context(), u.ID, date)
	switch {
	case err == nil:
		s.metrics.Inc("dailysolitaire_games_started_total", "")
	case errors.Is(err, store.ErrAlreadyPlayed):
	default:
		s.setFlash(w, "That deal isn't available: "+err.Error())
		http.Redirect(w, r, "/days", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/games/"+g.ID, http.StatusSeeOther)
}

// ownGame loads the game named in the URL for its owner, closing any games
// past their deadline first. It writes a 404 and returns false otherwise.
func (s *Server) ownGame(w http.ResponseWriter, r *http.Request) (*store.Game, bool) {
	_, _ = s.store.ExpireGames(r.Context())
	g, err := s.store.Game(r.Context(), r.PathValue("id"))
	if err != nil || g.UserID != user(r).ID {
		s.notFound(w, r)
		return nil, false
	}
	return g, true
}

func engineMoves(stored []store.StoredMove) []klondike.Move {
	out := make([]klondike.Move, len(stored))
	for i, m := range stored {
		out[i] = m.Move
	}
	return out
}

type gameData struct {
	Game      *store.Game
	Board     BoardView
	Timeline  []Tick
	CatchUp   bool
	Today     string
	Elapsed   string
	Remaining string
}

func (s *Server) gamePage(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownGame(w, r)
	if !ok {
		return
	}
	stored, err := s.store.Moves(r.Context(), g.ID)
	if err != nil {
		s.log.Error("load moves", "game", g.ID, "error", err)
		s.fail(w, r, http.StatusInternalServerError, "Could not load the game.")
		return
	}
	st, err := klondike.Replay(g.Seed, g.Rules, engineMoves(stored))
	if err != nil {
		s.log.Error("replay diverged", "game", g.ID, "error", err)
		s.fail(w, r, http.StatusInternalServerError, "This game could not be replayed.")
		return
	}
	d := gameData{
		Game: g, Today: dates.Today(s.store.Now()),
		Board:   buildBoard(st, g.ID, s.csrfToken(session(r)), len(stored), g.Over()),
		CatchUp: g.DealDate != dates.Today(g.StartedAt),
	}
	if g.Over() {
		d.Timeline = timeline(stored)
	} else if left := time.Until(g.Deadline); left > 0 {
		d.Remaining = formatDuration(left.Milliseconds())
	}
	s.render(w, r, http.StatusOK, "game", niceTitle(g.DealDate), d)
}

func niceTitle(date string) string {
	if t, err := dates.Parse(date); err == nil {
		return t.Format("Jan 2")
	}
	return date
}

// postMove is the single move endpoint: one POST, then a redirect back to the
// game page, where Turbo morphs the changed piles into place. An illegal or
// stale request (another tab moved first) redirects the same way, so the
// board simply re-renders from the server's state.
func (s *Server) postMove(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownGame(w, r)
	if !ok {
		return
	}
	back := "/games/" + g.ID
	redirect := func(reason string) {
		if reason != "" {
			s.metrics.Inc("dailysolitaire_rejected_moves_total", reason)
		}
		http.Redirect(w, r, back, http.StatusSeeOther)
	}
	if g.Over() {
		redirect("closed")
		return
	}
	seq, err := strconv.Atoi(r.PostFormValue("seq"))
	if err != nil {
		redirect("bad_request")
		return
	}
	stored, err := s.store.Moves(r.Context(), g.ID)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load the game.")
		return
	}
	if len(stored) != seq {
		redirect("stale")
		return
	}
	st, err := klondike.Replay(g.Seed, g.Rules, engineMoves(stored))
	if err != nil {
		s.log.Error("replay diverged", "game", g.ID, "error", err)
		s.fail(w, r, http.StatusInternalServerError, "This game could not be replayed.")
		return
	}

	req := klondike.Request{Type: klondike.MoveType(r.PostFormValue("type"))}
	if v := r.PostFormValue("card"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			redirect("bad_request")
			return
		}
		req.Card, req.HasCard = klondike.Card(n), true
	}
	if to := klondike.Pile(r.PostFormValue("to")); to != "" {
		if !to.Valid() {
			redirect("bad_request")
			return
		}
		req.To = to
	}

	var (
		moves  []klondike.Move
		result string
	)
	if req.Type == "auto" {
		moves = st.AutoPlan()
		if len(moves) == 0 {
			redirect("illegal")
			return
		}
		result = store.ResultWon
	} else {
		m, err := st.Resolve(req)
		if err != nil {
			redirect(rejectReason(err))
			return
		}
		m = st.Complete(m)
		if err := st.Apply(m); err != nil {
			redirect(rejectReason(err))
			return
		}
		moves = []klondike.Move{m}
		switch {
		case m.Type == klondike.TypeResign:
			result = store.ResultResigned
		case st.Won():
			result = store.ResultWon
		}
	}

	err = s.store.AppendMoves(r.Context(), store.Append{GameID: g.ID, ExpectSeq: seq, Moves: moves, Result: result})
	switch {
	case errors.Is(err, store.ErrConflict):
		redirect("stale")
		return
	case err != nil:
		s.log.Error("append moves", "game", g.ID, "error", err)
		s.fail(w, r, http.StatusInternalServerError, "Could not save the move.")
		return
	}
	for _, m := range moves {
		s.metrics.Inc("dailysolitaire_moves_total", string(m.Type))
	}
	if result != "" {
		s.metrics.Inc("dailysolitaire_games_finished_total", result)
	}
	redirect("")
}

func rejectReason(err error) string {
	if errors.Is(err, klondike.ErrNoMove) {
		return "no_destination"
	}
	return "illegal"
}

// ---- archive, boards, history ----

type dayRow struct {
	Date  string
	Today bool
	Game  *store.GameSummary
}

func (s *Server) daysPage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	_, _ = s.store.ExpireGames(ctx)
	games, err := s.store.GamesForUser(ctx, user(r).ID, 1000)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load your games.")
		return
	}
	byDate := map[string]*store.GameSummary{}
	for i := range games {
		byDate[games[i].DealDate] = &games[i]
	}
	today := dates.Today(s.store.Now())
	var rows []dayRow
	for _, d := range dates.Range(s.store.Now()) {
		rows = append(rows, dayRow{Date: d, Today: d == today, Game: byDate[d]})
	}
	s.render(w, r, http.StatusOK, "days", "Archive", rows)
}

type boardData struct {
	Date     string
	Unlocked bool
	Rows     []store.BoardRow
	Me       string
	Game     *store.GameSummary
}

func (s *Server) dayBoard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	date := r.PathValue("date")
	if _, err := dates.Parse(date); err != nil || date < dates.Epoch || date > dates.Today(s.store.Now()) {
		s.notFound(w, r)
		return
	}
	_, _ = s.store.ExpireGames(ctx)
	d := boardData{Date: date, Me: user(r).ID}
	if g, err := s.store.GameForDate(ctx, d.Me, date); err == nil {
		d.Game = &store.GameSummary{ID: g.ID, DealDate: g.DealDate, Result: g.Result}
		d.Unlocked = g.Over() // no spoilers until you've finished that date yourself
	}
	if d.Unlocked {
		rows, err := s.store.Board(ctx, date)
		if err != nil {
			s.fail(w, r, http.StatusInternalServerError, "Could not load the board.")
			return
		}
		d.Rows = rows
	}
	s.render(w, r, http.StatusOK, "day", niceTitle(date)+" board", d)
}

func (s *Server) historyPage(w http.ResponseWriter, r *http.Request) {
	games, err := s.store.GamesForUser(r.Context(), user(r).ID, 500)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load your games.")
		return
	}
	s.render(w, r, http.StatusOK, "history", "History", games)
}

func (s *Server) statsFrame(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.StatsFor(r.Context(), user(r).ID)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load stats.")
		return
	}
	s.render(w, r, http.StatusOK, "stats", "Stats", st)
}

// ---- replay viewer ----

type replayData struct {
	Game     *store.Game
	Board    BoardView
	Step     int
	Total    int
	Note     string
	Steps    []replayStep
	Timeline []Tick
}

type replayStep struct {
	N    int
	Text string
}

func (s *Server) replayPage(w http.ResponseWriter, r *http.Request) {
	g, ok := s.ownGame(w, r)
	if !ok {
		return
	}
	if !g.Over() {
		s.fail(w, r, http.StatusForbidden, "You can replay a game once it's finished.")
		return
	}
	stored, err := s.store.Moves(r.Context(), g.ID)
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "Could not load the game.")
		return
	}
	step := len(stored)
	if v := r.URL.Query().Get("step"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			step = max(0, min(n, len(stored)))
		}
	}
	st, err := klondike.Replay(g.Seed, g.Rules, engineMoves(stored[:step]))
	if err != nil {
		s.fail(w, r, http.StatusInternalServerError, "This game could not be replayed.")
		return
	}
	d := replayData{Game: g, Step: step, Total: len(stored), Board: buildBoard(st, g.ID, "", step, true), Timeline: timeline(stored)}
	if step > 0 {
		d.Note = describeMove(stored[step-1].Move)
	}
	for i, m := range stored {
		d.Steps = append(d.Steps, replayStep{N: i + 1, Text: describeMove(m.Move)})
	}
	s.render(w, r, http.StatusOK, "replay", "Replay "+niceTitle(g.DealDate), d)
}

func pileLabel(p klondike.Pile) string {
	if t, ok := p.Tableau(); ok {
		return fmt.Sprintf("column %d", t+1)
	}
	if _, ok := p.Foundation(); ok {
		return "foundation"
	}
	return string(p)
}

func describeMove(m klondike.Move) string {
	switch m.Type {
	case klondike.TypeDraw:
		return "Draw"
	case klondike.TypeRecycle:
		return "Recycle waste"
	case klondike.TypeUndo:
		return "Undo"
	case klondike.TypeResign:
		return "Resign"
	}
	label := "Auto: "
	if m.Type == klondike.TypeMove {
		label = ""
	}
	what := m.Cards[0].String()
	if len(m.Cards) > 1 {
		what = fmt.Sprintf("%s +%d", what, len(m.Cards)-1)
	}
	return fmt.Sprintf("%s%s: %s → %s", label, what, pileLabel(m.From), pileLabel(m.To))
}
