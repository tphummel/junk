package klondike

// Solve searches for a winning line from the opening deal of seed. It is used
// offline to prove deals winnable; no solver runs in production. The search
// sees every card (perfect information), which is exactly what "winnable"
// means for the seed pool. It returns the full move list (draws and recycles
// included) so the result is both a proof and a replay fixture, or ok=false if
// no line was found within maxNodes positions.
func Solve(seed uint64, rules Ruleset, maxNodes int) (moves []Move, ok bool) {
	root, err := New(seed, rules)
	if err != nil {
		return nil, false
	}
	sv := &solver{visited: make(map[string]struct{}, 1<<12), max: maxNodes}
	if sv.dfs(root) {
		// path was built leaf-to-root.
		for i, j := 0, len(sv.path)-1; i < j; i, j = i+1, j-1 {
			sv.path[i], sv.path[j] = sv.path[j], sv.path[i]
		}
		return fillCards(seed, rules, sv.path), true
	}
	return nil, false
}

// fillCards replays moves and records the cards turned over by draws and
// recycles, so the result is a complete, self-checking record.
func fillCards(seed uint64, rules Ruleset, moves []Move) []Move {
	s, _ := New(seed, rules)
	out := make([]Move, len(moves))
	for i, m := range moves {
		m = s.Complete(m)
		_ = s.Apply(m)
		out[i] = m
	}
	return out
}

type solver struct {
	visited map[string]struct{}
	max     int
	nodes   int
	path    []Move
}

func (sv *solver) dfs(s *State) bool {
	if s.Won() {
		return true
	}
	if s.CanAutoComplete() {
		// The path is built leaf-first, so the forced tail goes in reversed.
		plan := s.AutoPlan()
		for i := len(plan) - 1; i >= 0; i-- {
			sv.path = append(sv.path, plan[i])
		}
		return true
	}
	key := s.Key()
	if _, seen := sv.visited[key]; seen {
		return false
	}
	sv.visited[key] = struct{}{}
	sv.nodes++
	if sv.nodes > sv.max {
		return false
	}
	for _, m := range solverMoves(s) {
		next := s.Clone()
		next.undo = nil
		if err := next.Apply(m); err != nil {
			continue
		}
		if sv.dfs(next) {
			sv.path = append(sv.path, m)
			return true
		}
		if sv.nodes > sv.max {
			return false
		}
	}
	return false
}

// solverMoves lists candidate moves in search order. Foundation moves that
// can never hurt are returned alone (no branching).
func solverMoves(s *State) []Move {
	// Safe foundation moves.
	if m, ok := safeFoundationMove(s); ok {
		return []Move{m}
	}
	var reveal, other []Move

	// Tableau runs.
	for from := 0; from < NumColumns; from++ {
		col := s.Tab[from]
		if len(col.Cards) == 0 {
			continue
		}
		for k := col.Down; k < len(col.Cards); k++ {
			base := col.Cards[k]
			for to := 0; to < NumColumns; to++ {
				if to == from || !s.canTableau(base, to) {
					continue
				}
				if k == 0 && len(s.Tab[to].Cards) == 0 {
					continue
				}
				m := Move{Type: TypeMove, From: TableauPile(from), To: TableauPile(to), Cards: append([]Card(nil), col.Cards[k:]...)}
				if k == col.Down && col.Down > 0 {
					reveal = append(reveal, m)
				} else {
					other = append(other, m)
				}
			}
		}
	}
	// Waste to tableau.
	if len(s.Waste) > 0 {
		c := s.Waste[len(s.Waste)-1]
		for to := 0; to < NumColumns; to++ {
			if s.canTableau(c, to) {
				other = append(other, Move{Type: TypeMove, From: Waste, To: TableauPile(to), Cards: []Card{c}})
			}
		}
	}
	// Non-safe foundation moves (explored after the reveals).
	var found []Move
	for t := 0; t < NumColumns; t++ {
		col := s.Tab[t]
		if len(col.Cards) > 0 {
			c := col.Cards[len(col.Cards)-1]
			if s.canFoundation(c) {
				found = append(found, Move{Type: TypeMove, From: TableauPile(t), To: FoundationPile(c.Suit()), Cards: []Card{c}})
			}
		}
	}
	if len(s.Waste) > 0 {
		c := s.Waste[len(s.Waste)-1]
		if s.canFoundation(c) {
			found = append(found, Move{Type: TypeMove, From: Waste, To: FoundationPile(c.Suit()), Cards: []Card{c}})
		}
	}

	out := make([]Move, 0, len(reveal)+len(other)+len(found)+2)
	out = append(out, reveal...)
	out = append(out, found...)
	out = append(out, other...)
	if len(s.Stock) > 0 {
		out = append(out, Move{Type: TypeDraw})
	} else if s.CanRecycle() {
		out = append(out, Move{Type: TypeRecycle})
	}
	return out
}

// safeFoundationMove finds a foundation move no sane line would decline: an
// ace or deuce, or a card whose opposite-colour pair is already home.
func safeFoundationMove(s *State) (Move, bool) {
	safe := func(c Card) bool {
		if !s.canFoundation(c) {
			return false
		}
		r := c.Rank()
		if r <= 2 {
			return true
		}
		if c.Red() {
			return len(s.Found[Spades]) >= r-1 && len(s.Found[Clubs]) >= r-1
		}
		return len(s.Found[Hearts]) >= r-1 && len(s.Found[Diamonds]) >= r-1
	}
	if len(s.Waste) > 0 {
		c := s.Waste[len(s.Waste)-1]
		if safe(c) {
			return Move{Type: TypeMove, From: Waste, To: FoundationPile(c.Suit()), Cards: []Card{c}}, true
		}
	}
	for t := 0; t < NumColumns; t++ {
		col := s.Tab[t]
		if len(col.Cards) == 0 {
			continue
		}
		c := col.Cards[len(col.Cards)-1]
		if safe(c) {
			return Move{Type: TypeMove, From: TableauPile(t), To: FoundationPile(c.Suit()), Cards: []Card{c}}, true
		}
	}
	return Move{}, false
}
