# Flash Cards

This directory contains plain-text flash card decks for import into [Anki](https://apps.ankiweb.net/) desktop. Each deck is a `.txt` file with Anki's plain-text-import header directives (`#separator`, `#html`, `#notetype`, `#deck`) followed by one Cloze-format note per line (`{{c1::...}}`, `{{c2::...}}`, etc.).

## Importing a deck

In Anki desktop: **File → Import**, select the `.txt` file. Anki reads the header lines automatically and creates/targets the named deck with the `Cloze` note type — no manual field mapping needed.

`Cards/Airport Codes.txt` instead uses a `#deck column:2` header (requires Anki 2.1.54+): each row carries its own deck name in a second tab-separated column, so importing this single file creates/targets six separate subdecks under a shared `Airport Codes` parent (Anki nests on `::` in the deck name).

## Decks included

- `Cards/NATO Phonetic Alphabet.txt` – NATO phonetic alphabet, letter → code word (one-directional: the word is always hidden).
- `Cards/Units.txt` – common measurement units and relationships.
- `Cards/US Presidents.txt` – U.S. presidents, including non-consecutive terms.
- `Cards/Airport Codes.txt` – full airport name ↔ three-letter code, world airports, split by continent into `Airport Codes::North America`, `::South America`, `::Europe`, `::Africa`, `::Asia` (incl. Middle East), and `::Oceania` via the per-row deck column.

Each deck keeps one fact per line to make it easy to parse and edit with text-based tooling.
