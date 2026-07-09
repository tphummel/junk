# Flash Cards

This directory contains plain-text flash card decks for import into [Anki](https://apps.ankiweb.net/) desktop. Each deck is a `.txt` file with Anki's plain-text-import header directives (`#separator`, `#html`, `#notetype`, `#deck`) followed by one Cloze-format note per line (`{{c1::...}}`, `{{c2::...}}`, etc.).

## Importing a deck

In Anki desktop: **File → Import**, select the `.txt` file. Anki reads the header lines automatically and creates/targets the named deck with the `Cloze` note type — no manual field mapping needed.

## Decks included

- `Cards/NATO Phonetic Alphabet.txt` – NATO phonetic alphabet, letter → code word (one-directional: the word is always hidden).
- `Cards/Units.txt` – common measurement units and relationships.
- `Cards/US Presidents.txt` – U.S. presidents, including non-consecutive terms.
- `Cards/Airport Codes - North America.txt` – full airport name ↔ three-letter code → deck `Airport Codes::North America`.
- `Cards/Airport Codes - South America.txt` – → deck `Airport Codes::South America`.
- `Cards/Airport Codes - Europe.txt` – → deck `Airport Codes::Europe`.
- `Cards/Airport Codes - Africa.txt` – → deck `Airport Codes::Africa`.
- `Cards/Airport Codes - Asia.txt` – includes the Middle East → deck `Airport Codes::Asia`.
- `Cards/Airport Codes - Oceania.txt` – → deck `Airport Codes::Oceania`.

The airport-code decks import as subdecks of a shared `Airport Codes` parent deck (Anki nests on `::` in the deck name).

Each deck keeps one fact per line to make it easy to parse and edit with text-based tooling.
