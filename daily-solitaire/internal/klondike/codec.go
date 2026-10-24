package klondike

import (
	"fmt"
	"strings"
)

// FormatMoves renders moves in the compact text form used for seed-pool
// solutions and golden fixtures: space-separated tokens, where "D" is a draw,
// "R" a recycle, "U" an undo, "X" a resignation, and a move is
// "m<from>><to>:<cards>" (or "a..." for auto-complete), e.g. "mt3>t5:7H,6S".
func FormatMoves(moves []Move) string {
	parts := make([]string, len(moves))
	for i, m := range moves {
		parts[i] = m.String()
	}
	return strings.Join(parts, " ")
}

// String is the compact token for one move.
func (m Move) String() string {
	switch m.Type {
	case TypeDraw:
		return "D"
	case TypeRecycle:
		return "R"
	case TypeUndo:
		return "U"
	case TypeResign:
		return "X"
	}
	names := make([]string, len(m.Cards))
	for i, c := range m.Cards {
		names[i] = c.String()
	}
	prefix := "m"
	if m.Type == TypeAuto {
		prefix = "a"
	}
	return fmt.Sprintf("%s%s>%s:%s", prefix, m.From, m.To, strings.Join(names, ","))
}

// ParseMoves is the inverse of FormatMoves.
func ParseMoves(s string) ([]Move, error) {
	var out []Move
	for _, tok := range strings.Fields(s) {
		m, err := ParseMove(tok)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// ParseMove parses one compact token.
func ParseMove(tok string) (Move, error) {
	switch tok {
	case "D":
		return Move{Type: TypeDraw}, nil
	case "R":
		return Move{Type: TypeRecycle}, nil
	case "U":
		return Move{Type: TypeUndo}, nil
	case "X":
		return Move{Type: TypeResign}, nil
	}
	bad := fmt.Errorf("klondike: bad move token %q", tok)
	if len(tok) < 2 || (tok[0] != 'm' && tok[0] != 'a') {
		return Move{}, bad
	}
	m := Move{Type: TypeMove}
	if tok[0] == 'a' {
		m.Type = TypeAuto
	}
	route, cards, ok := strings.Cut(tok[1:], ":")
	if !ok {
		return Move{}, bad
	}
	from, to, ok := strings.Cut(route, ">")
	if !ok {
		return Move{}, bad
	}
	m.From, m.To = Pile(from), Pile(to)
	if !m.From.Valid() || !m.To.Valid() {
		return Move{}, bad
	}
	for _, name := range strings.Split(cards, ",") {
		c, ok := ParseCard(name)
		if !ok {
			return Move{}, bad
		}
		m.Cards = append(m.Cards, c)
	}
	return m, nil
}
