// Package klondike is the pure, deterministic Klondike rules engine: seeded
// deals, move validation, undo, and replay. It knows nothing about HTTP or
// storage; the server treats it as the single source of truth for legality.
package klondike

import (
	"fmt"
	"math/bits"
	"strconv"
	"strings"
)

// EngineVersion is recorded on every game. Bump it only when a change could
// alter how an existing recorded game replays; the golden suite must pass for
// every shipped version's fixtures.
const EngineVersion = 1

// Card is 0..51: suit*13 + (rank-1). Suits are ordered spades, hearts,
// diamonds, clubs; ranks run ace (1) through king (13).
type Card int

// Suits, in card-id order.
const (
	Spades = iota
	Hearts
	Diamonds
	Clubs
)

const (
	// NumCards is the size of the deck.
	NumCards = 52
	// NumColumns is the number of tableau columns.
	NumColumns = 7
)

var (
	suitLetters = "SHDC"
	rankLabels  = []string{"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"}
)

// Suit returns the card's suit index.
func (c Card) Suit() int { return int(c) / 13 }

// Rank returns 1 (ace) through 13 (king).
func (c Card) Rank() int { return int(c)%13 + 1 }

// Red reports whether the card is a heart or diamond.
func (c Card) Red() bool { s := c.Suit(); return s == Hearts || s == Diamonds }

// RankLabel is "A", "2".."10", "J", "Q" or "K".
func (c Card) RankLabel() string { return rankLabels[c.Rank()-1] }

// SuitLetter is "S", "H", "D" or "C".
func (c Card) SuitLetter() string { return string(suitLetters[c.Suit()]) }

// String is the short name, e.g. "10H" or "KS".
func (c Card) String() string { return c.RankLabel() + c.SuitLetter() }

// ParseCard parses the short name produced by String.
func ParseCard(s string) (Card, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) < 2 {
		return 0, false
	}
	suit := strings.IndexByte(suitLetters, s[len(s)-1])
	if suit < 0 {
		return 0, false
	}
	for i, l := range rankLabels {
		if l == s[:len(s)-1] {
			return Card(suit*13 + i), true
		}
	}
	return 0, false
}

// Valid reports whether c is a real card id.
func (c Card) Valid() bool { return c >= 0 && c < NumCards }

// Pile names a place cards can live: "stock", "waste", "f0".."f3" (one
// foundation per suit) or "t0".."t6" (tableau columns).
type Pile string

// Fixed pile names.
const (
	Stock Pile = "stock"
	Waste Pile = "waste"
)

// FoundationPile is the foundation for the given suit.
func FoundationPile(suit int) Pile { return Pile("f" + strconv.Itoa(suit)) }

// TableauPile is the tableau column with the given index.
func TableauPile(i int) Pile { return Pile("t" + strconv.Itoa(i)) }

// Foundation returns the suit index if p is a foundation pile.
func (p Pile) Foundation() (int, bool) { return p.indexed('f', 4) }

// Tableau returns the column index if p is a tableau pile.
func (p Pile) Tableau() (int, bool) { return p.indexed('t', NumColumns) }

func (p Pile) indexed(prefix byte, n int) (int, bool) {
	if len(p) != 2 || p[0] != prefix || p[1] < '0' || int(p[1]-'0') >= n {
		return 0, false
	}
	return int(p[1] - '0'), true
}

// Valid reports whether p is a known pile name.
func (p Pile) Valid() bool {
	if p == Stock || p == Waste {
		return true
	}
	_, f := p.Foundation()
	_, t := p.Tableau()
	return f || t
}

// rng is splitmix64: tiny, fast, and fixed forever so seeds replay exactly.
type rng struct{ s uint64 }

func (r *rng) next() uint64 {
	r.s += 0x9e3779b97f4a7c15
	z := r.s
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// intn returns a value in [0, n) using a multiply-high reduction.
func (r *rng) intn(n int) int {
	hi, _ := bits.Mul64(r.next(), uint64(n))
	return int(hi)
}

// Deck returns the shuffled 52-card order for a seed (Fisher-Yates driven by
// splitmix64). Changing this function invalidates every recorded game.
func Deck(seed uint64) []Card {
	deck := make([]Card, NumCards)
	for i := range deck {
		deck[i] = Card(i)
	}
	r := rng{s: seed}
	for i := NumCards - 1; i > 0; i-- {
		j := r.intn(i + 1)
		deck[i], deck[j] = deck[j], deck[i]
	}
	return deck
}

// FormatSeed renders a seed the way it is shown to people and stored in
// fixtures: 16 lowercase hex digits.
func FormatSeed(seed uint64) string { return fmt.Sprintf("%016x", seed) }

// ParseSeed is the inverse of FormatSeed.
func ParseSeed(s string) (uint64, error) { return strconv.ParseUint(s, 16, 64) }
