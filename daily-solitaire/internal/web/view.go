package web

import (
	"fmt"

	"daily-solitaire/internal/klondike"
	"daily-solitaire/internal/store"
)

// CardView is one card as the templates draw it.
type CardView struct {
	ID        string // stable DOM id: "c<n>" when face up, positional when face down
	Num       int
	Rank      string
	Suit      string // "s" "h" "d" "c"
	Label     string
	Up        bool
	Red       bool
	K         float64 // fan offset, in card-fan units
	Playable  bool    // tapping it submits a move
	Draggable bool
}

// ColView is one tableau column.
type ColView struct {
	Pile  string
	Cards []CardView
	W     float64
}

// FoundView is one foundation pile.
type FoundView struct {
	Pile  string
	Suit  string
	Name  string
	Count int
	Top   *CardView
}

// BoardView is everything the board template needs.
type BoardView struct {
	GameID     string
	CSRF       string
	Seq        int
	Moves      int
	ReadOnly   bool
	StockCount int
	CanDraw    bool
	CanRecycle bool
	Waste      []CardView
	WasteCount int
	Found      []FoundView
	Cols       []ColView
	CanUndo    bool
	CanAuto    bool
	DrawCount  int
	Recycles   int
	StepNote   string
}

var (
	suitKeys  = []string{"s", "h", "d", "c"}
	suitNames = []string{"spades", "hearts", "diamonds", "clubs"}
	rankNames = []string{"ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"}
)

func cardView(c klondike.Card) CardView {
	return CardView{
		ID: fmt.Sprintf("c%d", int(c)), Num: int(c), Rank: c.RankLabel(), Suit: suitKeys[c.Suit()],
		Label: rankNames[c.Rank()-1] + " of " + suitNames[c.Suit()], Up: true, Red: c.Red(),
	}
}

const (
	downFan = 0.3
	upFan   = 1.0
)

// buildBoard converts engine state into the view. Face-down and stock cards
// carry no identity: the page never says which card they are.
func buildBoard(st *klondike.State, gameID, csrf string, seq int, readOnly bool) BoardView {
	b := BoardView{
		GameID: gameID, CSRF: csrf, Seq: seq, Moves: st.Moves, ReadOnly: readOnly,
		StockCount: len(st.Stock), WasteCount: len(st.Waste), DrawCount: st.Rules.DrawCount, Recycles: st.Recycles,
		CanDraw: len(st.Stock) > 0, CanRecycle: st.CanRecycle(), CanUndo: st.CanUndo(), CanAuto: st.CanAutoComplete(),
	}
	if readOnly {
		b.CanDraw, b.CanRecycle, b.CanUndo, b.CanAuto = false, false, false, false
	}

	from := max(0, len(st.Waste)-3)
	for i := from; i < len(st.Waste); i++ {
		cv := cardView(st.Waste[i])
		cv.K = float64(i - from)
		if i == len(st.Waste)-1 && !readOnly {
			cv.Playable, cv.Draggable = true, true
		}
		b.Waste = append(b.Waste, cv)
	}

	for f := 0; f < 4; f++ {
		fv := FoundView{Pile: string(klondike.FoundationPile(f)), Suit: suitKeys[f], Name: suitNames[f], Count: len(st.Found[f])}
		if n := len(st.Found[f]); n > 0 {
			cv := cardView(st.Found[f][n-1])
			cv.Draggable = !readOnly
			fv.Top = &cv
		}
		b.Found = append(b.Found, fv)
	}

	for t := 0; t < klondike.NumColumns; t++ {
		col := st.Tab[t]
		cv := ColView{Pile: string(klondike.TableauPile(t))}
		k := 0.0
		for i, c := range col.Cards {
			var v CardView
			if i < col.Down {
				v = CardView{ID: fmt.Sprintf("d-t%d-%d", t, i), Label: "face-down card"}
				v.K = k
				k += downFan
			} else {
				v = cardView(c)
				v.K = k
				v.Playable, v.Draggable = !readOnly, !readOnly
				k += upFan
			}
			cv.Cards = append(cv.Cards, v)
		}
		cv.W = max(1, k-upFan)
		if len(col.Cards) == 0 {
			cv.W = 1
		}
		b.Cols = append(b.Cols, cv)
	}
	return b
}

// Tick is one move in a finished game's timeline.
type Tick struct {
	Class string
	Title string
	Tall  bool
}

func timeline(moves []store.StoredMove) []Tick {
	out := make([]Tick, len(moves))
	for i, m := range moves {
		t := Tick{Class: string(m.Move.Type), Title: fmt.Sprintf("%d. %s", i+1, m.Move.Type)}
		if _, ok := m.Move.To.Foundation(); ok {
			t.Class, t.Tall = "found", true
			t.Title = fmt.Sprintf("%d. to foundation", i+1)
		}
		out[i] = t
	}
	return out
}
