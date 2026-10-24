package klondike

import (
	"errors"
	"fmt"
)

// MoveType is the kind of recorded action.
type MoveType string

// Recorded action types, as stored in the moves table.
const (
	TypeMove    MoveType = "move"
	TypeDraw    MoveType = "draw"
	TypeRecycle MoveType = "recycle"
	TypeUndo    MoveType = "undo"
	TypeAuto    MoveType = "auto"
	TypeResign  MoveType = "resign"
)

// Move is one fully-resolved, recorded action. Cards lists the cards that
// moved (bottom of the moved run first; for a draw, in the order turned over).
type Move struct {
	Type  MoveType `json:"type"`
	From  Pile     `json:"from,omitempty"`
	To    Pile     `json:"to,omitempty"`
	Cards []Card   `json:"cards,omitempty"`
}

// Counts reports whether the action adds to the player's move counter.
func (m Move) Counts() bool {
	switch m.Type {
	case TypeMove, TypeDraw, TypeRecycle, TypeUndo:
		return true
	}
	return false
}

// Errors returned for rejected actions.
var (
	ErrIllegal  = errors.New("klondike: illegal move")
	ErrNoMove   = errors.New("klondike: no legal destination")
	ErrDiverged = errors.New("klondike: recorded move does not match replay")
)

func illegal(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrIllegal, fmt.Sprintf(format, a...))
}

// canFoundation reports whether c may be placed on its suit's foundation now.
func (s *State) canFoundation(c Card) bool {
	return c.Rank() == len(s.Found[c.Suit()])+1
}

// canTableau reports whether c (the base of a run) may be placed on column t.
func (s *State) canTableau(c Card, t int) bool {
	col := s.Tab[t]
	if len(col.Cards) == 0 {
		return c.Rank() == 13
	}
	top := col.Cards[len(col.Cards)-1]
	return top.Rank() == c.Rank()+1 && top.Red() != c.Red()
}

// Apply validates m against the position and, if legal, performs it. For
// recorded moves (replay) the Cards field is checked too, so any change in
// engine behaviour surfaces as ErrDiverged rather than a silent difference.
func (s *State) Apply(m Move) error {
	switch m.Type {
	case TypeMove, TypeAuto:
		return s.applyMove(m)
	case TypeDraw:
		return s.applyDraw(m)
	case TypeRecycle:
		return s.applyRecycle(m)
	case TypeUndo:
		return s.applyUndo()
	case TypeResign:
		return nil
	}
	return illegal("unknown type %q", m.Type)
}

func (s *State) applyMove(m Move) error {
	if !m.From.Valid() || !m.To.Valid() || m.From == m.To {
		return illegal("bad piles %q -> %q", m.From, m.To)
	}
	if m.From == Stock || m.To == Stock || m.To == Waste {
		return illegal("cannot move %q -> %q", m.From, m.To)
	}
	n := len(m.Cards)
	if n == 0 {
		return illegal("no cards")
	}
	src := s.Cards(m.From)
	if n > len(src) {
		return illegal("pile %s has %d cards", m.From, len(src))
	}
	run := src[len(src)-n:]
	for i, c := range m.Cards {
		if run[i] != c {
			return illegal("cards %v are not the top of %s", m.Cards, m.From)
		}
	}
	srcT, fromTableau := m.From.Tableau()
	if fromTableau {
		if n > len(src)-s.Tab[srcT].Down {
			return illegal("run includes face-down cards")
		}
	} else if n != 1 {
		return illegal("only one card may leave %s", m.From)
	}

	base := m.Cards[0]
	if f, ok := m.To.Foundation(); ok {
		if n != 1 || base.Suit() != f || !s.canFoundation(base) {
			return illegal("%s cannot go to %s", base, m.To)
		}
		s.Found[f] = append(s.Found[f], base)
	} else {
		t, _ := m.To.Tableau()
		if !s.canTableau(base, t) {
			return illegal("%s cannot go to %s", base, m.To)
		}
		s.Tab[t].Cards = append(s.Tab[t].Cards, m.Cards...)
	}

	// Remove from the source.
	flipped := false
	switch {
	case m.From == Waste:
		s.Waste = s.Waste[:len(s.Waste)-1]
	case fromTableau:
		col := &s.Tab[srcT]
		col.Cards = col.Cards[:len(col.Cards)-n]
		if col.Down > 0 && len(col.Cards) == col.Down {
			col.Down--
			flipped = true
		}
	default:
		f, _ := m.From.Foundation()
		s.Found[f] = s.Found[f][:len(s.Found[f])-1]
	}

	if m.Type == TypeAuto {
		s.undo = nil
		return nil
	}
	s.undo = append(s.undo, undoEntry{move: m, flipped: flipped})
	s.Moves++
	return nil
}

func (s *State) applyDraw(m Move) error {
	if len(s.Stock) == 0 {
		return illegal("stock is empty")
	}
	k := min(s.Rules.DrawCount, len(s.Stock))
	drawn := make([]Card, 0, k)
	for i := 0; i < k; i++ {
		c := s.Stock[len(s.Stock)-1]
		s.Stock = s.Stock[:len(s.Stock)-1]
		s.Waste = append(s.Waste, c)
		drawn = append(drawn, c)
	}
	if len(m.Cards) != 0 && !sameCards(m.Cards, drawn) {
		return ErrDiverged
	}
	s.undo = append(s.undo, undoEntry{move: Move{Type: TypeDraw, From: Stock, To: Waste, Cards: drawn}})
	s.Moves++
	return nil
}

func (s *State) applyRecycle(m Move) error {
	if !s.CanRecycle() {
		return illegal("cannot recycle")
	}
	recycled := append([]Card(nil), s.Waste...)
	if len(m.Cards) != 0 && !sameCards(m.Cards, recycled) {
		return ErrDiverged
	}
	for i := len(s.Waste) - 1; i >= 0; i-- {
		s.Stock = append(s.Stock, s.Waste[i])
	}
	s.Waste = s.Waste[:0]
	s.Recycles++
	s.undo = append(s.undo, undoEntry{move: Move{Type: TypeRecycle, From: Waste, To: Stock, Cards: recycled}})
	s.Moves++
	return nil
}

func (s *State) applyUndo() error {
	if len(s.undo) == 0 {
		return illegal("nothing to undo")
	}
	e := s.undo[len(s.undo)-1]
	s.undo = s.undo[:len(s.undo)-1]
	m := e.move
	switch m.Type {
	case TypeMove:
		n := len(m.Cards)
		var moved []Card
		if f, ok := m.To.Foundation(); ok {
			moved = s.Found[f][len(s.Found[f])-n:]
			s.Found[f] = s.Found[f][:len(s.Found[f])-n]
		} else {
			t, _ := m.To.Tableau()
			col := &s.Tab[t]
			moved = col.Cards[len(col.Cards)-n:]
			col.Cards = col.Cards[:len(col.Cards)-n]
		}
		moved = append([]Card(nil), moved...)
		switch {
		case m.From == Waste:
			s.Waste = append(s.Waste, moved...)
		default:
			if f, ok := m.From.Foundation(); ok {
				s.Found[f] = append(s.Found[f], moved...)
			} else {
				t, _ := m.From.Tableau()
				col := &s.Tab[t]
				if e.flipped {
					col.Down++
				}
				col.Cards = append(col.Cards, moved...)
			}
		}
	case TypeDraw:
		for range m.Cards {
			c := s.Waste[len(s.Waste)-1]
			s.Waste = s.Waste[:len(s.Waste)-1]
			s.Stock = append(s.Stock, c)
		}
	case TypeRecycle:
		s.Waste = s.Waste[:0]
		for i := len(s.Stock) - 1; i >= 0; i-- {
			s.Waste = append(s.Waste, s.Stock[i])
		}
		s.Stock = s.Stock[:0]
		s.Recycles--
	}
	s.Moves++
	return nil
}

func sameCards(a, b []Card) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Request is what a client may ask for. A move names a card and, optionally,
// a destination; the engine derives the source pile and the run length.
type Request struct {
	Type    MoveType
	Card    Card
	HasCard bool
	To      Pile
}

// Resolve turns a client request into a fully-specified Move without
// changing the state. A tap (no destination) follows one fixed rule: the
// foundation if the card can go there, otherwise the leftmost legal tableau
// column. A tap with nowhere to go returns ErrNoMove.
func (s *State) Resolve(req Request) (Move, error) {
	switch req.Type {
	case TypeDraw, TypeRecycle, TypeUndo, TypeResign:
		return Move{Type: req.Type}, nil
	case "", TypeMove:
	default:
		return Move{}, illegal("unknown type %q", req.Type)
	}
	if !req.HasCard || !req.Card.Valid() {
		return Move{}, illegal("no card")
	}
	loc, ok := s.Find(req.Card)
	if !ok || !loc.Up || loc.Pile == Stock {
		return Move{}, illegal("%s cannot be moved", req.Card)
	}
	pile := s.Cards(loc.Pile)
	var cards []Card
	if _, isTab := loc.Pile.Tableau(); isTab {
		cards = append(cards, pile[loc.Index:]...)
	} else {
		if loc.Index != len(pile)-1 {
			return Move{}, illegal("%s is not on top of %s", req.Card, loc.Pile)
		}
		cards = []Card{req.Card}
	}
	m := Move{Type: TypeMove, From: loc.Pile, Cards: cards}

	if req.To != "" {
		m.To = req.To
		return m, nil
	}
	if len(cards) == 1 {
		if _, fromFound := loc.Pile.Foundation(); !fromFound && s.canFoundation(req.Card) {
			m.To = FoundationPile(req.Card.Suit())
			return m, nil
		}
	}
	srcT, fromTab := loc.Pile.Tableau()
	for t := 0; t < NumColumns; t++ {
		if fromTab && t == srcT {
			continue
		}
		if !s.canTableau(req.Card, t) {
			continue
		}
		// Moving a king that already sits at the base of a column onto an
		// empty column achieves nothing.
		if fromTab && loc.Index == 0 && len(s.Tab[t].Cards) == 0 {
			continue
		}
		m.To = TableauPile(t)
		return m, nil
	}
	return Move{}, ErrNoMove
}

// CanAutoComplete reports whether the rest of the game is a forced win: the
// stock and waste are empty and no tableau card is face down.
func (s *State) CanAutoComplete() bool {
	if len(s.Stock) != 0 || len(s.Waste) != 0 || s.Won() {
		return false
	}
	for _, col := range s.Tab {
		if col.Down != 0 {
			return false
		}
	}
	return true
}

// AutoPlan returns the foundation moves that finish the game, in order. It
// does not change the state; apply each returned move to follow it.
func (s *State) AutoPlan() []Move {
	if !s.CanAutoComplete() {
		return nil
	}
	sim := s.Clone()
	var plan []Move
	for !sim.Won() {
		progressed := false
		for t := range sim.Tab {
			col := sim.Tab[t]
			if len(col.Cards) == 0 {
				continue
			}
			top := col.Cards[len(col.Cards)-1]
			if !sim.canFoundation(top) {
				continue
			}
			m := Move{Type: TypeAuto, From: TableauPile(t), To: FoundationPile(top.Suit()), Cards: []Card{top}}
			if err := sim.Apply(m); err != nil {
				return plan
			}
			plan = append(plan, m)
			progressed = true
			break
		}
		if !progressed {
			break
		}
	}
	return plan
}

// Replay deals the seed and applies the recorded moves in order.
func Replay(seed uint64, rules Ruleset, moves []Move) (*State, error) {
	s, err := New(seed, rules)
	if err != nil {
		return nil, err
	}
	for i, m := range moves {
		if err := s.Apply(m); err != nil {
			return nil, fmt.Errorf("move %d (%s): %w", i, m.Type, err)
		}
	}
	return s, nil
}

// Complete fills in what a resolved move leaves implicit — the piles and the
// cards turned over by a draw or recycle — so the recorded move is a
// self-checking record. It does not change the state.
func (s *State) Complete(m Move) Move {
	switch m.Type {
	case TypeDraw:
		m.From, m.To = Stock, Waste
		k := min(s.Rules.DrawCount, len(s.Stock))
		m.Cards = make([]Card, 0, k)
		for i := 0; i < k; i++ {
			m.Cards = append(m.Cards, s.Stock[len(s.Stock)-1-i])
		}
	case TypeRecycle:
		m.From, m.To = Waste, Stock
		m.Cards = append([]Card(nil), s.Waste...)
	}
	return m
}
