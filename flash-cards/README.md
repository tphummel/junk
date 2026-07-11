# Flash Cards

This directory contains plain-text flash card decks for import into [Anki](https://apps.ankiweb.net/) desktop. Each deck is a `.txt` file with Anki's plain-text-import header directives (`#separator`, `#html`, `#notetype`, `#deck`) followed by one Cloze-format note per line (`{{c1::...}}`, `{{c2::...}}`, etc.).

## Importing a deck

In Anki desktop: **File → Import**, select the `.txt` file. Anki reads the header lines automatically and creates/targets the named deck with the `Cloze` note type — no manual field mapping needed.

`Cards/Airport Codes.txt` and `Cards/Blackjack.txt` instead use a `#deck column:2` header (requires Anki 2.1.54+): each row carries its own deck name in a second tab-separated column, so importing either file creates/targets several subdecks under a shared parent (Anki nests on `::` in the deck name).

## Decks included

- `Cards/NATO Phonetic Alphabet.txt` – NATO phonetic alphabet, letter → code word (one-directional: the word is always hidden).
- `Cards/Units.txt` – common measurement units and relationships.
- `Cards/US Presidents.txt` – U.S. presidents, including non-consecutive terms.
- `Cards/Airport Codes.txt` – full airport name ↔ three-letter code, world airports, split by continent into `Airport Codes::North America`, `::South America`, `::Europe`, `::Africa`, `::Asia` (incl. Middle East), and `::Oceania` via the per-row deck column.
- `Cards/World Series Champions.txt` – MLB World Series champions, 1960–2025.
- `Cards/Blackjack.txt` – basic strategy, all under a shared `Blackjack` parent deck via the per-row deck column:
  - `Blackjack::General::Hard Totals`, `::Soft Totals`, `::Pairs` – your two down cards + dealer's up card → correct play (Hit/Stand/Double/Split/Surrender). Targets the typical Las Vegas Strip standard/low-limit table: 6–8 deck shoe, dealer **hits** soft 17 (H17), double after split allowed, late surrender allowed; cross-checked against the BlackjackReview.com multi-deck chart. Each hard/soft total uses one representative two-card hand, so it doesn't capture the composition-dependent exception (e.g. stand on any 3-card 16 vs. dealer 10).
  - `Blackjack::H17 vs S17` (5 hands), `::DAS vs No DAS` (7 hands, baseline H17 shoe), `::Double Restriction (Any Two vs 10-11 Only)` (24 hands, baseline H17 shoe) – drills only the hands where the correct play flips between two rulesets. The ruleset is stated on the front, not clozed, since it's the given context the answer depends on; only the action is hidden, with one card per ruleset per hand. Skips the single/double-deck variant.

Each deck keeps one fact per line to make it easy to parse and edit with text-based tooling.
