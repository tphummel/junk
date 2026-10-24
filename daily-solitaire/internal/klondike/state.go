package klondike

import (
	"errors"
	"fmt"
)

// Ruleset is the per-game rule configuration, stored as JSON on the game.
type Ruleset struct {
	// DrawCount is how many cards one draw turns over (1 or 3).
	DrawCount int `json:"draw_count"`
	// PassLimit is the number of passes through the stock; 0 is unlimited.
	PassLimit int `json:"pass_limit"`
}

// DefaultRuleset is the daily game: draw 3, unlimited passes.
func DefaultRuleset() Ruleset { return Ruleset{DrawCount: 3, PassLimit: 0} }

// Validate rejects rulesets the engine cannot play.
func (r Ruleset) Validate() error {
	if r.DrawCount != 1 && r.DrawCount != 3 {
		return fmt.Errorf("klondike: draw_count must be 1 or 3, got %d", r.DrawCount)
	}
	if r.PassLimit < 0 {
		return errors.New("klondike: pass_limit must not be negative")
	}
	return nil
}

// Column is one tableau column. The first Down cards are face down; the rest
// are a face-up run, bottom to top.
type Column struct {
	Cards []Card
	Down  int
}

// Up returns the face-up cards of the column.
func (c Column) Up() []Card { return c.Cards[c.Down:] }

// State is a Klondike position plus the bookkeeping needed to undo. It is
// always derived by replaying moves from a seed; it is never persisted.
type State struct {
	Rules    Ruleset
	Stock    []Card // top of the stock is the last element
	Waste    []Card // top of the waste is the last element
	Found    [4][]Card
	Tab      [NumColumns]Column
	Recycles int
	// Moves is the number of counted player actions (move, draw, recycle,
	// undo). Auto-complete and resign add none.
	Moves int

	undo []undoEntry
}

type undoEntry struct {
	move    Move
	flipped bool // a face-down tableau card was turned up by this move
}

// New deals a fresh game from a seed: column i gets i+1 cards with the last
// face up, and the remaining 24 cards form the stock.
func New(seed uint64, rules Ruleset) (*State, error) {
	if err := rules.Validate(); err != nil {
		return nil, err
	}
	deck := Deck(seed)
	s := &State{Rules: rules}
	n := 0
	for i := 0; i < NumColumns; i++ {
		s.Tab[i] = Column{Cards: append([]Card(nil), deck[n:n+i+1]...), Down: i}
		n += i + 1
	}
	s.Stock = append([]Card(nil), deck[n:]...)
	return s, nil
}

// Clone returns a deep copy (including undo history).
func (s *State) Clone() *State {
	c := *s
	c.Stock = append([]Card(nil), s.Stock...)
	c.Waste = append([]Card(nil), s.Waste...)
	for i := range s.Found {
		c.Found[i] = append([]Card(nil), s.Found[i]...)
	}
	for i := range s.Tab {
		c.Tab[i] = Column{Cards: append([]Card(nil), s.Tab[i].Cards...), Down: s.Tab[i].Down}
	}
	c.undo = append([]undoEntry(nil), s.undo...)
	return &c
}

// Won reports whether all four foundations are complete.
func (s *State) Won() bool {
	for _, f := range s.Found {
		if len(f) != 13 {
			return false
		}
	}
	return true
}

// CanUndo reports whether there is an action to undo.
func (s *State) CanUndo() bool { return len(s.undo) > 0 }

// CanRecycle reports whether the waste may be turned back into the stock.
func (s *State) CanRecycle() bool {
	if len(s.Stock) != 0 || len(s.Waste) == 0 {
		return false
	}
	return s.Rules.PassLimit == 0 || s.Recycles < s.Rules.PassLimit-1
}

// Cards returns the cards in a pile, bottom to top.
func (s *State) Cards(p Pile) []Card {
	switch {
	case p == Stock:
		return s.Stock
	case p == Waste:
		return s.Waste
	}
	if i, ok := p.Foundation(); ok {
		return s.Found[i]
	}
	if i, ok := p.Tableau(); ok {
		return s.Tab[i].Cards
	}
	return nil
}

// Location is where a card currently sits.
type Location struct {
	Pile  Pile
	Index int  // position within the pile, bottom = 0
	Up    bool // face up
}

// Find locates a card.
func (s *State) Find(c Card) (Location, bool) {
	for i, x := range s.Stock {
		if x == c {
			return Location{Stock, i, false}, true
		}
	}
	for i, x := range s.Waste {
		if x == c {
			return Location{Waste, i, true}, true
		}
	}
	for f := range s.Found {
		for i, x := range s.Found[f] {
			if x == c {
				return Location{FoundationPile(f), i, true}, true
			}
		}
	}
	for t := range s.Tab {
		for i, x := range s.Tab[t].Cards {
			if x == c {
				return Location{TableauPile(t), i, i >= s.Tab[t].Down}, true
			}
		}
	}
	return Location{}, false
}

// Key is a canonical string for the position. Two states with equal keys have
// identical futures, which makes it the golden-test fingerprint and the
// solver's visited-set key.
func (s *State) Key() string {
	b := make([]byte, 0, 96)
	for _, c := range s.Stock {
		b = append(b, byte(c))
	}
	b = append(b, 0xff)
	for _, c := range s.Waste {
		b = append(b, byte(c))
	}
	b = append(b, 0xff)
	for _, f := range s.Found {
		b = append(b, byte(len(f)))
	}
	for _, col := range s.Tab {
		b = append(b, 0xff, byte(col.Down))
		for _, c := range col.Cards {
			b = append(b, byte(c))
		}
	}
	if s.Rules.PassLimit > 0 {
		b = append(b, 0xff, byte(s.Recycles))
	}
	return string(b)
}
