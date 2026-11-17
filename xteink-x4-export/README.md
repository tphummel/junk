# xteink-x4-export

Decode the raw files from an Xteink X4 e-ink reader export (CrossPoint Reader firmware, older binary layout)
into JSON: library, recent books, per-book reading progress and stats, book metadata/TOC, covers.

## Use

Copy `.metadata/` and `.system/` from the SD card into an empty directory (a zip of them works too, unzip it first).
Only the files `wantedPath()` in `x4.mjs` accepts are read; `sections/`, `images/` and `wifi.bin` are skipped.

```sh
node extract.mjs some-empty-dir                       # JSON on stdout, password redacted, wifi omitted
node extract.mjs some-empty-dir --covers covers/      # also write covers/<id>.jpg
node extract.mjs some-empty-dir --include-secrets     # include OPDS password
```

Node 22, no dependencies. `x4.mjs` has no Node APIs (`decodeExport(Map<path, Uint8Array>)`), so it can move into a
browser tool as is. Plan: frontend-only page under `web/` using fflate to read the zip into that Map.

## Status of the formats

Verified against the firmware source (obijuankenobiii/inx `src/state/Statistics.cpp`, which matches these files
byte for byte) and against each other: `statistics.bin` (reading ms, pages read, chapters read, sessions, percent,
spine/page, avg page time), `system/statistics.bin` (books started/finished, totals), `book.bin`, `recent.bin`, `state.bin`.
The "page turns" and "sessions" I first reported were mislabeled: they are pages read (5 s+ on the page) and chapters read;
real sessions is the last field (a sitting counts after 45 s).

**There are no dates.** The one timestamp-like field, `lastReadTimeMs`, is `millis()` (uptime since boot). The firmware only
records wall-clock time for bookmarks/annotations.

Guesses: `books.bin` header field and the `id`/`type` pair, `state.bin` trailing byte.

Not decoded:
- `progress.bin` bytes 6-7 (`rawU16[3]`, ~16330 on finished books, 0 otherwise).
- `settings.bin` apart from the OPDS URL/user/password strings (no setting names or values).
- `sections/N.bin`, the per-chapter layout cache (version differs from upstream). It holds the book text as laid-out
  words, so recovering text is possible but is a bigger job. Natural next step, and what's needed to extract highlights-style data.
- `wifi.bin` is deliberately skipped.

## Sample result (this export)

4 books, 9.8 h reading and 790 page turns recorded across 3 finished books (Rogue Protocol, 11.6%, 43 min / 44 turns, not yet in the system totals).
