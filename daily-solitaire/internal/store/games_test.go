package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"daily-solitaire/internal/klondike"
)

func newUser(t *testing.T, s *Store, name string) *User {
	t.Helper()
	u, err := s.CreateUser(context.Background(), name, name)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestDailyDealIsSharedAndSeededFromPool(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	fixedClock(s)
	if n, err := s.LoadSeeds(ctx, map[uint64]string{11: "D", 22: "D", 33: "D"}); err != nil || n != 3 {
		t.Fatalf("load: %d %v", n, err)
	}
	a, b := newUser(t, s, "ann"), newUser(t, s, "bob")

	// Many simultaneous first players of the same day all read the same winner.
	var wg sync.WaitGroup
	seeds := make(chan uint64, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, err := s.DealFor(ctx, "2026-10-24", a.ID)
			if err != nil {
				t.Error(err)
				return
			}
			seeds <- d.Seed
		}()
	}
	wg.Wait()
	close(seeds)
	var first uint64
	for sd := range seeds {
		if first == 0 {
			first = sd
		}
		if sd != first {
			t.Fatalf("players saw different seeds: %d and %d", first, sd)
		}
	}
	if first != 11 && first != 22 && first != 33 {
		t.Fatalf("seed %d did not come from the pool", first)
	}
	total, unused, _ := s.SeedPoolStats(ctx)
	if total != 3 || unused != 2 {
		t.Fatalf("pool total=%d unused=%d; only the day's seed should be consumed", total, unused)
	}

	ga, err := s.StartGame(ctx, a.ID, "2026-10-24")
	if err != nil {
		t.Fatal(err)
	}
	gb, err := s.StartGame(ctx, b.ID, "2026-10-24")
	if err != nil {
		t.Fatal(err)
	}
	if ga.Seed != gb.Seed || ga.Seed != first {
		t.Fatal("players got different deals for the same day")
	}
}

func TestEmptyPoolStillMintsADeal(t *testing.T) {
	s := openTest(t)
	fixedClock(s)
	d, err := s.DealFor(context.Background(), "2026-10-24", "")
	if err != nil || d.Pooled {
		t.Fatalf("deal=%+v err=%v", d, err)
	}
}

func TestOnePlayPerDeal(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	fixedClock(s)
	u := newUser(t, s, "ann")
	g, err := s.StartGame(ctx, u.ID, "2026-10-24")
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.StartGame(ctx, u.ID, "2026-10-24")
	if !errors.Is(err, ErrAlreadyPlayed) || again.ID != g.ID {
		t.Fatalf("second start: %v %v", again, err)
	}
	for _, bad := range []string{"2026-09-30", "2026-10-25", "garbage"} {
		if _, err := s.StartGame(ctx, u.ID, bad); err == nil {
			t.Errorf("started a game for %s", bad)
		}
	}
	// Catch-up is allowed once per past date.
	if _, err := s.StartGame(ctx, u.ID, "2026-10-01"); err != nil {
		t.Fatal(err)
	}
}

func TestAppendMovesStaleSeqAndCounting(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "ann")
	g, _ := s.StartGame(ctx, u.ID, "2026-10-24")

	draw := klondike.Move{Type: klondike.TypeDraw, From: klondike.Stock, To: klondike.Waste, Cards: []klondike.Card{1, 2, 3}}
	undo := klondike.Move{Type: klondike.TypeUndo}
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 0, Moves: []klondike.Move{draw}}); err != nil {
		t.Fatal(err)
	}
	// A second tab still thinks seq is 0.
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 0, Moves: []klondike.Move{draw}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale append: %v", err)
	}
	*clock = clock.Add(90 * time.Second)
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 1, Moves: []klondike.Move{undo}}); err != nil {
		t.Fatal(err)
	}
	moves, _ := s.Moves(ctx, g.ID)
	if len(moves) != 2 || moves[0].Move.Cards[2] != 3 || moves[1].Move.Type != klondike.TypeUndo {
		t.Fatalf("moves: %+v", moves)
	}
	got, _ := s.Game(ctx, g.ID)
	if got.MoveCount != 2 {
		t.Fatalf("move_count %d, undo must count", got.MoveCount)
	}
	// Auto moves are recorded but not counted; the win closes the game.
	auto := klondike.Move{Type: klondike.TypeAuto, From: "t0", To: "f0", Cards: []klondike.Card{0}}
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 2, Moves: []klondike.Move{auto}, Result: ResultWon}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Game(ctx, g.ID)
	if got.MoveCount != 2 || got.Result != ResultWon || got.ElapsedMS == nil || *got.ElapsedMS != 90000 {
		t.Fatalf("finished game: %+v elapsed=%v", got, got.ElapsedMS)
	}
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 3, Moves: []klondike.Move{draw}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("append to a finished game: %v", err)
	}
}

func TestExpireGamesAtThreeAMPacific(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "ann")
	g, _ := s.StartGame(ctx, u.ID, "2026-10-24")

	// 02:59 PDT on the 25th: still playable.
	*clock = time.Date(2026, 10, 25, 9, 59, 0, 0, time.UTC)
	if n, _ := s.ExpireGames(ctx); n != 0 {
		t.Fatalf("expired %d games early", n)
	}
	// 03:00 PDT: closed as a loss.
	*clock = time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	if n, _ := s.ExpireGames(ctx); n != 1 {
		t.Fatalf("expired %d games, want 1", n)
	}
	got, _ := s.Game(ctx, g.ID)
	if got.Result != ResultExpired || got.EndedAt == nil || !got.EndedAt.Equal(got.Deadline) {
		t.Fatalf("expired game: %+v", got)
	}
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 0, Moves: []klondike.Move{{Type: klondike.TypeUndo}}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("resume after expiry: %v", err)
	}
}

func finish(t *testing.T, s *Store, clock *time.Time, userID, date, result string, counted int, elapsed time.Duration) {
	t.Helper()
	ctx := context.Background()
	g, err := s.StartGame(ctx, userID, date)
	if err != nil {
		t.Fatal(err)
	}
	start := *clock
	var ms []klondike.Move
	for i := 0; i < counted; i++ {
		ms = append(ms, klondike.Move{Type: klondike.TypeDraw})
	}
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 0, Moves: ms[:1]}); err != nil {
		t.Fatal(err)
	}
	*clock = start.Add(elapsed)
	if err := s.AppendMoves(ctx, Append{GameID: g.ID, ExpectSeq: 1, Moves: ms[1:], Result: result}); err != nil {
		t.Fatal(err)
	}
	*clock = start
}

func TestBoardRanksWinsThenMovesThenTime(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	names := []string{"slow", "fast", "fewer", "loser"}
	users := map[string]*User{}
	for _, n := range names {
		users[n] = newUser(t, s, n)
	}
	finish(t, s, clock, users["slow"].ID, "2026-10-24", ResultWon, 100, 600*time.Second)
	finish(t, s, clock, users["fast"].ID, "2026-10-24", ResultWon, 100, 300*time.Second)
	finish(t, s, clock, users["fewer"].ID, "2026-10-24", ResultWon, 90, 900*time.Second)
	finish(t, s, clock, users["loser"].ID, "2026-10-24", ResultResigned, 5, 10*time.Second)

	board, err := s.Board(ctx, "2026-10-24")
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, r := range board {
		order = append(order, r.DisplayName)
	}
	want := []string{"fewer", "fast", "slow", "loser"}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("board order %v, want %v", order, want)
		}
	}
}

func TestStatsAndStreaks(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "ann")
	results := map[string]string{
		"2026-10-20": ResultWon, "2026-10-21": ResultWon, "2026-10-22": ResultResigned,
		"2026-10-23": ResultWon, "2026-10-24": ResultWon,
	}
	for _, d := range []string{"2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"} {
		finish(t, s, clock, u.ID, d, results[d], 50, time.Minute)
	}
	st, err := s.StatsFor(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Played != 5 || st.Wins != 4 || st.WinRate != 80 || st.AvgMoves != 50 {
		t.Fatalf("stats: %+v", st)
	}
	if st.BestStreak != 2 || st.CurrentStreak != 2 {
		t.Fatalf("streaks: best %d current %d", st.BestStreak, st.CurrentStreak)
	}
}

func TestDeleteUserCascades(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "ann")
	other := newUser(t, s, "bob")
	finish(t, s, clock, u.ID, "2026-10-24", ResultWon, 10, time.Minute)
	finish(t, s, clock, other.ID, "2026-10-24", ResultWon, 20, time.Minute)
	if _, err := s.AddCredential(ctx, u.ID, []byte("raw"), "{}", "", "key"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateSession(ctx, u.ID, "ua", time.Hour, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUser(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	board, _ := s.Board(ctx, "2026-10-24")
	if len(board) != 1 || board[0].DisplayName != "bob" {
		t.Fatalf("deleted user's result is still on the board: %+v", board)
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM moves WHERE game_id NOT IN (SELECT id FROM games)`,
		`SELECT COUNT(*) FROM credentials WHERE user_id = '` + u.ID + `'`,
		`SELECT COUNT(*) FROM sessions WHERE user_id = '` + u.ID + `'`,
		`SELECT COUNT(*) FROM games WHERE user_id = '` + u.ID + `'`,
	} {
		var n int
		if err := s.r.QueryRow(q).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s -> %d (%v)", q, n, err)
		}
	}
	var moves int
	s.r.QueryRow(`SELECT COUNT(*) FROM moves`).Scan(&moves)
	if moves != 20 {
		t.Fatalf("other user's moves = %d, want 20", moves)
	}
}

func TestAccountSessionsAndRecovery(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "Ann")
	if _, err := s.CreateUser(ctx, "ann", "dup"); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("usernames must be unique case-insensitively: %v", err)
	}

	tok, err := s.CreateSession(ctx, u.ID, "Mozilla", time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	sess, got, err := s.SessionByToken(ctx, tok)
	if err != nil || got.ID != u.ID || sess.Fresh(s.Now()) {
		t.Fatalf("session lookup: %v fresh=%v", err, sess != nil && sess.Fresh(s.Now()))
	}
	if err := s.MarkFresh(ctx, sess.ID, 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	sess, _, _ = s.SessionByToken(ctx, tok)
	if !sess.Fresh(s.Now()) || sess.Fresh(s.Now().Add(6*time.Minute)) {
		t.Fatal("step-up freshness window wrong")
	}
	*clock = clock.Add(2 * time.Hour)
	if _, _, err := s.SessionByToken(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session accepted")
	}
	*clock = clock.Add(-2 * time.Hour)

	// Disabling signs the user out everywhere.
	if err := s.SetDisabled(ctx, u.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SessionByToken(ctx, tok); !errors.Is(err, ErrNotFound) {
		t.Fatal("disabled user kept a session")
	}

	codes, err := s.NewRecoveryCodes(ctx, u.ID, 8)
	if err != nil || len(codes) != 8 {
		t.Fatal(err)
	}
	if id, err := s.ConsumeRecoveryCode(ctx, codes[0]); err != nil || id != u.ID {
		t.Fatalf("consume: %v %v", id, err)
	}
	if _, err := s.ConsumeRecoveryCode(ctx, codes[0]); !errors.Is(err, ErrNotFound) {
		t.Fatal("recovery code reused")
	}
	if n, _ := s.RecoveryCodesLeft(ctx, u.ID); n != 7 {
		t.Fatalf("codes left %d", n)
	}
	link, _ := s.NewRecoveryLink(ctx, u.ID, time.Hour)
	if _, err := s.ConsumeRecoveryLink(ctx, link); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConsumeRecoveryLink(ctx, link); !errors.Is(err, ErrNotFound) {
		t.Fatal("recovery link reused")
	}

	// Challenges are single use.
	id, _ := s.PutChallenge(ctx, "login", "", "{}", time.Minute)
	if _, _, err := s.TakeChallenge(ctx, id, "login"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.TakeChallenge(ctx, id, "login"); !errors.Is(err, ErrNotFound) {
		t.Fatal("challenge reused")
	}
}

func TestCannotRevokeLastPasskey(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	u := newUser(t, s, "ann")
	a, _ := s.AddCredential(ctx, u.ID, []byte("a"), "{}", "", "a")
	if _, err := s.DeleteCredential(ctx, u.ID, a.ID); !errors.Is(err, ErrLastCredential) {
		t.Fatalf("got %v", err)
	}
	b, _ := s.AddCredential(ctx, u.ID, []byte("b"), "{}", "", "b")
	if _, err := s.DeleteCredential(ctx, u.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteCredential(ctx, u.ID, b.ID); !errors.Is(err, ErrLastCredential) {
		t.Fatalf("got %v", err)
	}
}

func TestExportArchive(t *testing.T) {
	ctx := context.Background()
	s := openTest(t)
	clock := fixedClock(s)
	u := newUser(t, s, "ann")
	finish(t, s, clock, u.ID, "2026-10-24", ResultResigned, 3, time.Minute)
	a, err := s.ExportUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if a.Format != "daily-solitaire-archive" || len(a.Games) != 1 || len(a.Games[0].Moves) != 3 || a.Games[0].Result != "resigned" {
		t.Fatalf("archive: %+v", a)
	}
}
