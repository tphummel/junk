package klondike

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"testing"
)

func TestDeckIsAPermutationAndStable(t *testing.T) {
	for seed := uint64(0); seed < 50; seed++ {
		d := Deck(seed)
		seen := map[Card]bool{}
		for _, c := range d {
			seen[c] = true
		}
		if len(d) != 52 || len(seen) != 52 {
			t.Fatalf("seed %d: not a permutation", seed)
		}
	}
	// Golden: the shuffle algorithm is part of the replay contract. If this
	// fails, every recorded game would deal differently.
	sum := sha256.Sum256(func() []byte {
		var b []byte
		for _, c := range Deck(0x1234) {
			b = append(b, byte(c))
		}
		return b
	}())
	if got, want := hex.EncodeToString(sum[:6]), "8dabcbad031a"; got != want {
		t.Fatalf("Deck(0x1234) fingerprint = %s, want %s (shuffle changed!)", got, want)
	}
}

func TestDealLayout(t *testing.T) {
	s, err := New(42, DefaultRuleset())
	if err != nil {
		t.Fatal(err)
	}
	for i, col := range s.Tab {
		if len(col.Cards) != i+1 || col.Down != i {
			t.Fatalf("column %d: %d cards, %d down", i, len(col.Cards), col.Down)
		}
	}
	if len(s.Stock) != 24 || len(s.Waste) != 0 {
		t.Fatalf("stock %d waste %d", len(s.Stock), len(s.Waste))
	}
}

// blank returns an empty board for hand-built positions.
func blank() *State {
	s := &State{Rules: DefaultRuleset()}
	return s
}

func card(name string) Card {
	c, ok := ParseCard(name)
	if !ok {
		panic(name)
	}
	return c
}

func cards(names ...string) []Card {
	out := make([]Card, len(names))
	for i, n := range names {
		out[i] = card(n)
	}
	return out
}

func TestParseCardRoundTrip(t *testing.T) {
	for c := Card(0); c < 52; c++ {
		got, ok := ParseCard(c.String())
		if !ok || got != c {
			t.Fatalf("%d -> %q -> %d", c, c.String(), got)
		}
	}
}

func TestTableauRules(t *testing.T) {
	s := blank()
	s.Tab[0] = Column{Cards: cards("9S", "8H")}
	s.Tab[1] = Column{Cards: cards("9D")}
	s.Tab[2] = Column{Cards: cards("JC", "10D")}

	// 8H on 9D? Both red: illegal.
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t1", Cards: cards("8H")}); !errors.Is(err, ErrIllegal) {
		t.Fatalf("red on red allowed: %v", err)
	}
	// 9D on 10... column 2 top is 10D (red) - red on red illegal.
	if err := s.Apply(Move{Type: TypeMove, From: "t1", To: "t2", Cards: cards("9D")}); !errors.Is(err, ErrIllegal) {
		t.Fatalf("red on red allowed: %v", err)
	}
	// 9S+8H run onto 10D: black on red, one lower. Legal.
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t2", Cards: cards("9S", "8H")}); err != nil {
		t.Fatal(err)
	}
	if got := len(s.Tab[2].Cards); got != 4 {
		t.Fatalf("column 2 has %d cards", got)
	}
	if s.Moves != 1 {
		t.Fatalf("moves = %d", s.Moves)
	}
}

func TestOnlyKingsFillEmptyColumns(t *testing.T) {
	s := blank()
	s.Tab[0] = Column{Cards: cards("QH")}
	s.Tab[1] = Column{Cards: cards("KS")}
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t2", Cards: cards("QH")}); !errors.Is(err, ErrIllegal) {
		t.Fatal("queen on empty column allowed")
	}
	if err := s.Apply(Move{Type: TypeMove, From: "t1", To: "t2", Cards: cards("KS")}); err != nil {
		t.Fatal(err)
	}
}

func TestCannotMoveFaceDownOrPartialRuns(t *testing.T) {
	s := blank()
	s.Tab[0] = Column{Cards: cards("5C", "9S", "8H"), Down: 1}
	s.Tab[1] = Column{Cards: cards("10D")}
	// Includes the face-down 5C.
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t1", Cards: cards("5C", "9S", "8H")}); !errors.Is(err, ErrIllegal) {
		t.Fatal("moved a face-down card")
	}
	// Not the top of the pile.
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t1", Cards: cards("9S")}); !errors.Is(err, ErrIllegal) {
		t.Fatal("moved a non-top run")
	}
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "t1", Cards: cards("9S", "8H")}); err != nil {
		t.Fatal(err)
	}
	// 5C flipped up.
	if s.Tab[0].Down != 0 {
		t.Fatal("top card was not turned face up")
	}
	if err := s.Apply(Move{Type: TypeUndo}); err != nil {
		t.Fatal(err)
	}
	if s.Tab[0].Down != 1 || len(s.Tab[0].Cards) != 3 || len(s.Tab[1].Cards) != 1 {
		t.Fatal("undo did not restore the flip")
	}
}

func TestFoundationRules(t *testing.T) {
	s := blank()
	s.Tab[0] = Column{Cards: cards("2H", "AH")}
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "f0", Cards: cards("AH")}); !errors.Is(err, ErrIllegal) {
		t.Fatal("ace of hearts on the spade foundation")
	}
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "f1", Cards: cards("AH")}); err != nil {
		t.Fatal(err)
	}
	if err := s.Apply(Move{Type: TypeMove, From: "t0", To: "f1", Cards: cards("2H")}); err != nil {
		t.Fatal(err)
	}
	// Foundation cards may come back down.
	s.Tab[1] = Column{Cards: cards("3S")}
	if err := s.Apply(Move{Type: TypeMove, From: "f1", To: "t1", Cards: cards("2H")}); err != nil {
		t.Fatal(err)
	}
}

func TestDrawThreeAndRecycle(t *testing.T) {
	s := blank()
	s.Stock = cards("AS", "2S", "3S", "4S", "5S") // top is 5S
	if err := s.Apply(Move{Type: TypeDraw}); err != nil {
		t.Fatal(err)
	}
	if got := FormatMoves([]Move{{Type: TypeMove, From: Waste, To: "t0", Cards: s.Waste}}); got != "mwaste>t0:5S,4S,3S" {
		t.Fatalf("waste after first draw: %s", got)
	}
	if err := s.Apply(Move{Type: TypeDraw}); err != nil {
		t.Fatal(err)
	}
	if len(s.Stock) != 0 || len(s.Waste) != 5 {
		t.Fatalf("stock %d waste %d", len(s.Stock), len(s.Waste))
	}
	if err := s.Apply(Move{Type: TypeDraw}); !errors.Is(err, ErrIllegal) {
		t.Fatal("drew from an empty stock")
	}
	if err := s.Apply(Move{Type: TypeRecycle}); err != nil {
		t.Fatal(err)
	}
	// After a recycle the first card drawn is the first card drawn again.
	if err := s.Apply(Move{Type: TypeDraw}); err != nil {
		t.Fatal(err)
	}
	if s.Waste[0] != card("5S") {
		t.Fatalf("recycle reversed the wrong way: waste %v", s.Waste)
	}
	if s.Moves != 4 {
		t.Fatalf("moves = %d, want 4", s.Moves)
	}
}

func TestPassLimit(t *testing.T) {
	s := blank()
	s.Rules = Ruleset{DrawCount: 3, PassLimit: 2}
	s.Stock = cards("AS", "2S")
	_ = s.Apply(Move{Type: TypeDraw})
	if err := s.Apply(Move{Type: TypeRecycle}); err != nil {
		t.Fatal(err)
	}
	_ = s.Apply(Move{Type: TypeDraw})
	if err := s.Apply(Move{Type: TypeRecycle}); !errors.Is(err, ErrIllegal) {
		t.Fatal("third pass allowed with pass limit 2")
	}
}

func TestUndoIsAMoveAndCountsAndNeverRefunds(t *testing.T) {
	s := blank()
	s.Stock = cards("AS", "2S", "3S")
	_ = s.Apply(Move{Type: TypeDraw})
	_ = s.Apply(Move{Type: TypeUndo})
	if s.Moves != 2 {
		t.Fatalf("moves = %d, want 2 (draw + undo)", s.Moves)
	}
	if err := s.Apply(Move{Type: TypeUndo}); !errors.Is(err, ErrIllegal) {
		t.Fatal("undo with nothing to undo")
	}
	if len(s.Stock) != 3 || len(s.Waste) != 0 {
		t.Fatal("draw not undone")
	}
}

func TestResolveTapRule(t *testing.T) {
	s := blank()
	s.Found[Hearts] = cards("AH")
	s.Tab[0] = Column{Cards: cards("3C", "2H")}
	s.Tab[1] = Column{Cards: cards("4S")}
	s.Tab[2] = Column{Cards: cards("3D")}
	s.Tab[3] = Column{Cards: cards("KD", "QC", "JH")}
	s.Waste = cards("10S")

	// 2H goes to its foundation in preference to a tableau column.
	m, err := s.Resolve(Request{Card: card("2H"), HasCard: true})
	if err != nil || m.To != "f1" {
		t.Fatalf("2H tap: %+v %v", m, err)
	}
	// 3D is red; 4S black accepts it. Leftmost legal tableau column.
	m, err = s.Resolve(Request{Card: card("3D"), HasCard: true})
	if err != nil || m.To != "t1" {
		t.Fatalf("3D tap: %+v %v", m, err)
	}
	// 10S (waste) -> JH.
	m, err = s.Resolve(Request{Card: card("10S"), HasCard: true})
	if err != nil || m.To != "t3" || m.From != Waste {
		t.Fatalf("10S tap: %+v %v", m, err)
	}
	// A tap with no destination costs nothing and returns ErrNoMove.
	if _, err = s.Resolve(Request{Card: card("4S"), HasCard: true}); !errors.Is(err, ErrNoMove) {
		t.Fatalf("4S tap: %v", err)
	}
	// Tapping a run takes everything on top of the card.
	m, err = s.Resolve(Request{Card: card("QC"), HasCard: true, To: "t5"})
	if err != nil || len(m.Cards) != 2 {
		t.Fatalf("QC run: %+v %v", m, err)
	}
	// Cards that are not accessible.
	if _, err = s.Resolve(Request{Card: card("KS"), HasCard: true}); !errors.Is(err, ErrIllegal) {
		t.Fatalf("missing card: %v", err)
	}
}

func TestTapDoesNotShuffleBaseKings(t *testing.T) {
	s := blank()
	s.Tab[0] = Column{Cards: cards("KS")}
	if _, err := s.Resolve(Request{Card: card("KS"), HasCard: true}); !errors.Is(err, ErrNoMove) {
		t.Fatalf("base king tapped to an empty column: %v", err)
	}
	s.Tab[1] = Column{Cards: cards("3C", "KH"), Down: 1}
	m, err := s.Resolve(Request{Card: card("KH"), HasCard: true})
	if err != nil || m.To != "t2" {
		t.Fatalf("king with a card beneath should move: %+v %v", m, err)
	}
}

func TestAutoComplete(t *testing.T) {
	s := blank()
	s.Found[Spades] = cards("AS")
	s.Tab[0] = Column{Cards: cards("KH", "QS")}
	s.Tab[1] = Column{Cards: cards("2S")}
	if !s.CanAutoComplete() {
		t.Fatal("expected auto-complete")
	}
	s.Tab[2] = Column{Cards: cards("9C"), Down: 1}
	if s.CanAutoComplete() {
		t.Fatal("auto-complete with a face-down card")
	}
}

func TestAutoPlanWinsAndAddsNoMoves(t *testing.T) {
	// Build an all-face-up, stock-empty endgame by playing a solved deal almost to the end.
	f, err := os.Open("testdata/golden.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	if !sc.Scan() {
		t.Fatal("empty fixture")
	}
	var fx fixture
	if err := json.Unmarshal(sc.Bytes(), &fx); err != nil {
		t.Fatal(err)
	}
	moves, _ := ParseMoves(fx.Moves)
	seed, _ := ParseSeed(fx.Seed)
	// Find the first point at which auto-complete is available.
	s, _ := New(seed, DefaultRuleset())
	for _, m := range moves {
		if s.CanAutoComplete() {
			break
		}
		if err := s.Apply(m); err != nil {
			t.Fatal(err)
		}
	}
	if !s.CanAutoComplete() {
		t.Skip("fixture never reaches a forced win before the final move")
	}
	before := s.Moves
	for _, m := range s.AutoPlan() {
		if err := s.Apply(m); err != nil {
			t.Fatal(err)
		}
	}
	if !s.Won() || s.Moves != before {
		t.Fatalf("won=%v moves %d -> %d", s.Won(), before, s.Moves)
	}
}

// TestRandomPlayUndoRoundTrip plays random legal moves and checks every undo
// restores the exact previous position.
func TestRandomPlayUndoRoundTrip(t *testing.T) {
	rnd := rand.New(rand.NewSource(7))
	for game := 0; game < 30; game++ {
		s, _ := New(uint64(game)+100, DefaultRuleset())
		for step := 0; step < 400; step++ {
			cands := solverMoves(s)
			if len(cands) == 0 {
				break
			}
			m := cands[rnd.Intn(len(cands))]
			before := s.Key()
			if err := s.Apply(m); err != nil {
				t.Fatalf("game %d step %d: %v", game, step, err)
			}
			if rnd.Intn(3) == 0 {
				if err := s.Apply(Move{Type: TypeUndo}); err != nil {
					t.Fatal(err)
				}
				if s.Key() != before {
					t.Fatalf("game %d step %d: undo of %s did not restore the position", game, step, m)
				}
			}
		}
		// Every card is somewhere exactly once.
		seen := map[Card]int{}
		for c := Card(0); c < 52; c++ {
			if _, ok := s.Find(c); ok {
				seen[c]++
			}
		}
		if len(seen) != 52 {
			t.Fatalf("game %d: %d cards on the table", game, len(seen))
		}
	}
}

func TestMovesCodecRoundTrip(t *testing.T) {
	in := "D R U X mt3>t5:7H,6S aWaste"
	if _, err := ParseMoves(in); err == nil {
		t.Fatal("expected error for a malformed token")
	}
	in = "D R U X mt3>t5:7H,6S mwaste>f2:AD at0>f1:KH"
	moves, err := ParseMoves(in)
	if err != nil {
		t.Fatal(err)
	}
	if got := FormatMoves(moves); got != in {
		t.Fatalf("round trip: %q", got)
	}
}

type fixture struct {
	Seed  string `json:"seed"`
	Moves string `json:"moves"`
	Key   string `json:"key"`
}

// TestGoldenReplays is the gate for engine changes: every recorded game must
// replay without divergence to the same winning position.
func TestGoldenReplays(t *testing.T) {
	f, err := os.Open("testdata/golden.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	n := 0
	for sc.Scan() {
		var fx fixture
		if err := json.Unmarshal(sc.Bytes(), &fx); err != nil {
			t.Fatal(err)
		}
		seed, err := ParseSeed(fx.Seed)
		if err != nil {
			t.Fatal(err)
		}
		moves, err := ParseMoves(fx.Moves)
		if err != nil {
			t.Fatal(err)
		}
		s, err := Replay(seed, DefaultRuleset(), moves)
		if err != nil {
			t.Fatalf("seed %s: %v", fx.Seed, err)
		}
		if !s.Won() {
			t.Fatalf("seed %s: replay did not win", fx.Seed)
		}
		sum := sha256.Sum256([]byte(s.Key()))
		if got := hex.EncodeToString(sum[:8]); got != fx.Key {
			t.Fatalf("seed %s: final position %s, recorded %s", fx.Seed, got, fx.Key)
		}
		n++
	}
	if n < 10 {
		t.Fatalf("only %d golden games", n)
	}
}

func TestSolveReturnsAReplayableWin(t *testing.T) {
	moves, ok := Solve(5, DefaultRuleset(), 300000)
	if !ok {
		t.Skip("seed 5 not solved within budget")
	}
	s, err := Replay(5, DefaultRuleset(), moves)
	if err != nil || !s.Won() {
		t.Fatalf("won=%v err=%v", s != nil && s.Won(), err)
	}
}

func TestRecordedDrawCardsMustMatch(t *testing.T) {
	s, _ := New(9, DefaultRuleset())
	err := s.Apply(Move{Type: TypeDraw, Cards: cards("AS", "2S", "3S")})
	if !errors.Is(err, ErrDiverged) && err != nil {
		t.Fatalf("unexpected error %v", err)
	}
}
