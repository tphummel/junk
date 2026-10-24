package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"daily-solitaire/internal/dates"
	"daily-solitaire/internal/klondike"
)

// Variant is the only game for now.
const Variant = "klondike"

// Game result values; an in-progress game has the empty result.
const (
	ResultWon      = "won"
	ResultResigned = "resigned"
	ResultExpired  = "expired"
)

// Deal is a day's shared deal.
type Deal struct {
	Date   string
	Rules  klondike.Ruleset
	Seed   uint64
	Pooled bool
}

// Game is one player's play of one deal.
type Game struct {
	ID            string
	UserID        string
	Variant       string
	Rules         klondike.Ruleset
	Seed          uint64
	DealDate      string
	StartedAt     time.Time
	FirstMoveAt   *time.Time
	EndedAt       *time.Time
	Deadline      time.Time
	Result        string
	MoveCount     int
	ElapsedMS     *int64
	EngineVersion int
}

// Over reports whether the game has ended.
func (g *Game) Over() bool { return g.Result != "" }

// StoredMove is a recorded action.
type StoredMove struct {
	Seq  int
	Move klondike.Move
	At   time.Time
}

// ErrAlreadyPlayed is returned when a user starts a deal they have already
// started; the existing game is returned alongside it.
var ErrAlreadyPlayed = errors.New("store: deal already played")

// ErrConflict means the client's view of the game was stale or the game is
// over; nothing was written.
var ErrConflict = errors.New("store: stale or closed game")

func seedToDB(seed uint64) int64   { return int64(seed) }
func seedFromDB(seed int64) uint64 { return uint64(seed) }

// hydrateDeal returns the deal for a date, minting it if this is the first
// request. The insert is ON CONFLICT DO NOTHING followed by a SELECT, so two
// simultaneous first players both read the same winning seed.
func (s *Store) hydrateDeal(ctx context.Context, tx *sql.Tx, date, byUser string) (Deal, error) {
	if d, ok, err := s.dealRow(ctx, tx, date); err != nil || ok {
		return d, err
	}
	rules := klondike.DefaultRuleset()
	rulesJSON, _ := json.Marshal(rules)

	// Pick a candidate seed: a random unused pooled seed if any, else a random
	// seed that has not been proven winnable.
	var (
		candidate int64
		pooled    bool
	)
	err := tx.QueryRowContext(ctx, `SELECT seed FROM seed_pool WHERE used_date IS NULL ORDER BY random() LIMIT 1`).Scan(&candidate)
	switch {
	case err == nil:
		pooled = true
	case errors.Is(err, sql.ErrNoRows):
		var b [8]byte
		if _, err := rand.Read(b[:]); err != nil {
			return Deal{}, err
		}
		candidate = int64(binary.BigEndian.Uint64(b[:]))
		slog.Warn("seed pool is empty; minting an unproven seed", "date", date)
	default:
		return Deal{}, err
	}

	var by any
	if byUser != "" {
		by = byUser
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO daily_deals (date, variant, ruleset, seed, pooled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(date) DO NOTHING`,
		date, Variant, string(rulesJSON), candidate, pooled, ts(s.Now()), by); err != nil {
		return Deal{}, err
	}

	d, _, err := s.dealRow(ctx, tx, date)
	if err != nil {
		return Deal{}, err
	}
	seed := seedToDB(d.Seed)
	if pooled && seed == candidate {
		if _, err := tx.ExecContext(ctx, `UPDATE seed_pool SET used_date = ? WHERE seed = ?`, date, candidate); err != nil {
			return Deal{}, err
		}
	}
	return d, nil
}

// dealRow reads a date's deal, reporting whether it exists.
func (s *Store) dealRow(ctx context.Context, tx *sql.Tx, date string) (Deal, bool, error) {
	var (
		d      Deal
		seed   int64
		rules  string
		pooled int
	)
	err := tx.QueryRowContext(ctx, `SELECT date, ruleset, seed, pooled FROM daily_deals WHERE date = ?`, date).Scan(&d.Date, &rules, &seed, &pooled)
	if errors.Is(err, sql.ErrNoRows) {
		return Deal{}, false, nil
	}
	if err != nil {
		return Deal{}, false, err
	}
	if err := json.Unmarshal([]byte(rules), &d.Rules); err != nil {
		return Deal{}, false, err
	}
	d.Seed, d.Pooled = seedFromDB(seed), pooled == 1
	return d, true, nil
}

// DealFor returns (minting if needed) the deal for a playable date.
func (s *Store) DealFor(ctx context.Context, date, byUser string) (Deal, error) {
	if err := dates.Playable(date, s.Now()); err != nil {
		return Deal{}, err
	}
	var d Deal
	err := s.tx(ctx, func(tx *sql.Tx) (err error) {
		d, err = s.hydrateDeal(ctx, tx, date, byUser)
		return
	})
	return d, err
}

const gameCols = `id, user_id, variant, ruleset, seed, deal_date, started_at, first_move_at, ended_at, deadline,
	COALESCE(result, ''), move_count, elapsed_ms, engine_version`

func scanGame(row interface{ Scan(...any) error }) (*Game, error) {
	var (
		g                 Game
		rules             string
		seed              int64
		started, deadline string
		first, ended      sql.NullString
		elapsed           sql.NullInt64
	)
	if err := row.Scan(&g.ID, &g.UserID, &g.Variant, &rules, &seed, &g.DealDate, &started, &first, &ended, &deadline,
		&g.Result, &g.MoveCount, &elapsed, &g.EngineVersion); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := json.Unmarshal([]byte(rules), &g.Rules); err != nil {
		return nil, err
	}
	g.Seed = seedFromDB(seed)
	g.StartedAt, g.Deadline = parseTS(started), parseTS(deadline)
	g.FirstMoveAt, g.EndedAt = parseNullTS(first), parseNullTS(ended)
	if elapsed.Valid {
		g.ElapsedMS = &elapsed.Int64
	}
	return &g, nil
}

// StartGame begins the user's one play of a date's deal. If they already have
// a game for the date it is returned along with ErrAlreadyPlayed.
func (s *Store) StartGame(ctx context.Context, userID, date string) (*Game, error) {
	now := s.Now()
	if err := dates.Playable(date, now); err != nil {
		return nil, err
	}
	var game *Game
	err := s.tx(ctx, func(tx *sql.Tx) error {
		existing, err := scanGame(tx.QueryRowContext(ctx, `SELECT `+gameCols+` FROM games WHERE user_id = ? AND deal_date = ?`, userID, date))
		if err == nil {
			game = existing
			return ErrAlreadyPlayed
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		deal, err := s.hydrateDeal(ctx, tx, date, userID)
		if err != nil {
			return err
		}
		rulesJSON, _ := json.Marshal(deal.Rules)
		g := &Game{
			ID: s.newID(), UserID: userID, Variant: Variant, Rules: deal.Rules, Seed: deal.Seed, DealDate: date,
			StartedAt: now, Deadline: dates.Deadline(now), EngineVersion: klondike.EngineVersion,
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO games (id, user_id, variant, ruleset, seed, deal_date, started_at, deadline, engine_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			g.ID, userID, g.Variant, string(rulesJSON), seedToDB(g.Seed), date, ts(now), ts(g.Deadline), g.EngineVersion); err != nil {
			return err
		}
		game = g
		return nil
	})
	return game, err
}

// Game loads a game by id.
func (s *Store) Game(ctx context.Context, id string) (*Game, error) {
	return scanGame(s.r.QueryRowContext(ctx, `SELECT `+gameCols+` FROM games WHERE id = ?`, id))
}

// GameForDate loads the user's game for a deal date.
func (s *Store) GameForDate(ctx context.Context, userID, date string) (*Game, error) {
	return scanGame(s.r.QueryRowContext(ctx, `SELECT `+gameCols+` FROM games WHERE user_id = ? AND deal_date = ?`, userID, date))
}

// Moves returns every recorded action of a game in order.
func (s *Store) Moves(ctx context.Context, gameID string) ([]StoredMove, error) {
	return queryMoves(ctx, s.r, gameID)
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func queryMoves(ctx context.Context, q queryer, gameID string) ([]StoredMove, error) {
	rows, err := q.QueryContext(ctx, `SELECT seq, type, from_pile, to_pile, cards, created_at FROM moves WHERE game_id = ? ORDER BY seq`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StoredMove
	for rows.Next() {
		var (
			sm        StoredMove
			typ       string
			from, to  string
			cardsJSON string
			at        string
		)
		if err := rows.Scan(&sm.Seq, &typ, &from, &to, &cardsJSON, &at); err != nil {
			return nil, err
		}
		sm.Move = klondike.Move{Type: klondike.MoveType(typ), From: klondike.Pile(from), To: klondike.Pile(to)}
		if err := json.Unmarshal([]byte(cardsJSON), &sm.Move.Cards); err != nil {
			return nil, fmt.Errorf("move %d of game %s: %w", sm.Seq, gameID, err)
		}
		sm.At = parseTS(at)
		out = append(out, sm)
	}
	return out, rows.Err()
}

// Append is a batch of moves to add to a game, plus how the game ends if it does.
type Append struct {
	GameID    string
	ExpectSeq int // the number of moves the caller replayed to get here
	Moves     []klondike.Move
	// Result, if set, ends the game with this result.
	Result string
}

// AppendMoves adds moves in one transaction. It returns ErrConflict, writing
// nothing, if the game already ended or its move count is no longer
// ExpectSeq (another tab moved first).
func (s *Store) AppendMoves(ctx context.Context, a Append) error {
	now := s.Now()
	return s.tx(ctx, func(tx *sql.Tx) error {
		var (
			count   int
			counted int
			result  sql.NullString
			first   sql.NullString
		)
		if err := tx.QueryRowContext(ctx,
			`SELECT (SELECT COUNT(*) FROM moves WHERE game_id = g.id), g.move_count, g.result, g.first_move_at FROM games g WHERE g.id = ?`, a.GameID).
			Scan(&count, &counted, &result, &first); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if result.Valid || count != a.ExpectSeq {
			return ErrConflict
		}
		for i, m := range a.Moves {
			cards, _ := json.Marshal(append([]klondike.Card{}, m.Cards...))
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO moves (game_id, seq, type, from_pile, to_pile, cards, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				a.GameID, count+i, string(m.Type), string(m.From), string(m.To), string(cards), ts(now)); err != nil {
				return err
			}
			if m.Counts() {
				counted++
			}
		}
		firstAt := first.String
		if !first.Valid && len(a.Moves) > 0 {
			firstAt = ts(now)
		}
		if a.Result == "" {
			_, err := tx.ExecContext(ctx, `UPDATE games SET move_count = ?, first_move_at = NULLIF(?, '') WHERE id = ?`, counted, firstAt, a.GameID)
			return err
		}
		var elapsed any
		if firstAt != "" {
			elapsed = now.Sub(parseTS(firstAt)).Milliseconds()
		}
		_, err := tx.ExecContext(ctx,
			`UPDATE games SET move_count = ?, first_move_at = NULLIF(?, ''), ended_at = ?, result = ?, elapsed_ms = ? WHERE id = ?`,
			counted, firstAt, ts(now), a.Result, elapsed, a.GameID)
		return err
	})
}

// ExpireGames closes every unfinished game past its deadline as a loss. It
// returns how many were closed.
func (s *Store) ExpireGames(ctx context.Context) (int, error) {
	now := ts(s.Now())
	res, err := s.w.ExecContext(ctx,
		`UPDATE games SET result = 'expired', ended_at = deadline,
		        elapsed_ms = CASE WHEN first_move_at IS NULL THEN NULL
		                          ELSE CAST((julianday(deadline) - julianday(first_move_at)) * 86400000 AS INTEGER) END
		 WHERE result IS NULL AND deadline <= ?`, now)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// ---- history, stats, boards ----

// GameSummary is a row in a player's history.
type GameSummary struct {
	ID        string
	DealDate  string
	Result    string
	MoveCount int
	ElapsedMS *int64
	Deadline  time.Time
}

// GamesForUser lists the user's games, newest deal first.
func (s *Store) GamesForUser(ctx context.Context, userID string, limit int) ([]GameSummary, error) {
	rows, err := s.r.QueryContext(ctx,
		`SELECT id, deal_date, COALESCE(result, ''), move_count, elapsed_ms, deadline FROM games WHERE user_id = ? ORDER BY deal_date DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GameSummary
	for rows.Next() {
		var (
			g        GameSummary
			elapsed  sql.NullInt64
			deadline string
		)
		if err := rows.Scan(&g.ID, &g.DealDate, &g.Result, &g.MoveCount, &elapsed, &deadline); err != nil {
			return nil, err
		}
		if elapsed.Valid {
			g.ElapsedMS = &elapsed.Int64
		}
		g.Deadline = parseTS(deadline)
		out = append(out, g)
	}
	return out, rows.Err()
}

// Stats summarises a player's finished games.
type Stats struct {
	Played        int
	Wins          int
	WinRate       float64
	AvgMoves      float64
	BestMoves     int
	BestMS        int64
	CurrentStreak int
	BestStreak    int
}

// StatsFor reads the stats views for one user.
func (s *Store) StatsFor(ctx context.Context, userID string) (Stats, error) {
	var st Stats
	var avg sql.NullFloat64
	var best, bestMS sql.NullInt64
	err := s.r.QueryRowContext(ctx, `SELECT played, wins, win_rate, avg_moves, best_moves, best_ms FROM v_user_stats WHERE user_id = ?`, userID).
		Scan(&st.Played, &st.Wins, &st.WinRate, &avg, &best, &bestMS)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return st, err
	}
	st.AvgMoves, st.BestMoves, st.BestMS = avg.Float64, int(best.Int64), bestMS.Int64

	if err := s.r.QueryRowContext(ctx, `SELECT COALESCE(MAX(length), 0) FROM v_win_streaks WHERE user_id = ?`, userID).Scan(&st.BestStreak); err != nil {
		return st, err
	}
	// The current streak is a run that includes today or yesterday.
	err = s.r.QueryRowContext(ctx, `SELECT COALESCE(MAX(length), 0) FROM v_win_streaks WHERE user_id = ? AND end_date >= ?`,
		userID, dates.Yesterday(s.Now())).Scan(&st.CurrentStreak)
	return st, err
}

// BoardRow is one line of a day's board.
type BoardRow struct {
	Rank        int
	UserID      string
	DisplayName string
	Result      string
	MoveCount   int
	ElapsedMS   *int64
}

// Board returns a date's ranked results: wins first, then fewest moves, then
// fastest wall-clock time.
func (s *Store) Board(ctx context.Context, date string) ([]BoardRow, error) {
	rows, err := s.r.QueryContext(ctx,
		`SELECT rank, user_id, display_name, result, move_count, elapsed_ms FROM v_daily_board WHERE deal_date = ? ORDER BY rank`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BoardRow
	for rows.Next() {
		var (
			b       BoardRow
			elapsed sql.NullInt64
		)
		if err := rows.Scan(&b.Rank, &b.UserID, &b.DisplayName, &b.Result, &b.MoveCount, &elapsed); err != nil {
			return nil, err
		}
		if elapsed.Valid {
			b.ElapsedMS = &elapsed.Int64
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ---- seed pool ----

// LoadSeeds adds proven-winnable seeds (with their solutions) to the pool,
// skipping ones already present. It returns how many were new.
func (s *Store) LoadSeeds(ctx context.Context, seeds map[uint64]string) (int, error) {
	added := 0
	err := s.tx(ctx, func(tx *sql.Tx) error {
		for seed, solution := range seeds {
			res, err := tx.ExecContext(ctx, `INSERT INTO seed_pool (seed, solution) VALUES (?, ?) ON CONFLICT(seed) DO NOTHING`, seedToDB(seed), solution)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n > 0 {
				added++
			}
		}
		return nil
	})
	return added, err
}

// SeedPoolStats reports pool size and how many seeds remain unused.
func (s *Store) SeedPoolStats(ctx context.Context) (total, unused int, err error) {
	err = s.r.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(used_date IS NULL), 0) FROM seed_pool`).Scan(&total, &unused)
	return
}

// ---- export ----

// ArchiveGame is a game in the export archive.
type ArchiveGame struct {
	ID       string           `json:"id"`
	Variant  string           `json:"variant"`
	Ruleset  klondike.Ruleset `json:"ruleset"`
	Seed     string           `json:"seed"`
	DealDate string           `json:"deal_date"`
	Started  string           `json:"started"`
	Ended    string           `json:"ended,omitempty"`
	Result   string           `json:"result,omitempty"`
	Engine   int              `json:"engine_version"`
	Moves    []ArchiveMove    `json:"moves"`
}

// ArchiveMove is a move in the export archive.
type ArchiveMove struct {
	Seq   int      `json:"seq"`
	Type  string   `json:"type"`
	From  string   `json:"from,omitempty"`
	To    string   `json:"to,omitempty"`
	Cards []string `json:"cards,omitempty"`
	At    string   `json:"at"`
}

// Archive is the versioned export format.
type Archive struct {
	Format  string        `json:"format"`
	Version int           `json:"version"`
	Games   []ArchiveGame `json:"games"`
}

// ExportUser builds the full archive for a user: every game and every move.
func (s *Store) ExportUser(ctx context.Context, userID string) (*Archive, error) {
	a := &Archive{Format: "daily-solitaire-archive", Version: 1, Games: []ArchiveGame{}}
	rows, err := s.r.QueryContext(ctx, `SELECT `+gameCols+` FROM games WHERE user_id = ? ORDER BY deal_date`, userID)
	if err != nil {
		return nil, err
	}
	var games []*Game
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		games = append(games, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, g := range games {
		ag := ArchiveGame{
			ID: g.ID, Variant: g.Variant, Ruleset: g.Rules, Seed: klondike.FormatSeed(g.Seed), DealDate: g.DealDate,
			Started: ts(g.StartedAt), Result: g.Result, Engine: g.EngineVersion, Moves: []ArchiveMove{},
		}
		if g.EndedAt != nil {
			ag.Ended = ts(*g.EndedAt)
		}
		moves, err := s.Moves(ctx, g.ID)
		if err != nil {
			return nil, err
		}
		for _, m := range moves {
			am := ArchiveMove{Seq: m.Seq, Type: string(m.Move.Type), From: string(m.Move.From), To: string(m.Move.To), At: ts(m.At)}
			for _, c := range m.Move.Cards {
				am.Cards = append(am.Cards, c.String())
			}
			ag.Moves = append(ag.Moves, am)
		}
		a.Games = append(a.Games, ag)
	}
	return a, nil
}
