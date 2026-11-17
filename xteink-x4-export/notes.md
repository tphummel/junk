# Notes

## 2026-11-16
- Input: `~/Downloads/xteink x4.zip` (7.6 MB, 68 files: 65 `.bin`, 20 jpg, 3 png). Extracted to a scratch dir, never into the repo.
- Layout: `system/{settings,state,statistics,wifi}.bin`, `metadata/{books,recent}.bin`,
  `metadata/epub/<hash>/{book,progress,statistics}.bin + cover.jpg, thumb.jpg, images/, sections/N.bin`.
- Firmware is CrossPoint Reader (github.com/crosspoint-reader/crosspoint-reader). Upstream `main` has moved
  settings/state/recent to JSON, but this device runs an older binary layout, so upstream source only helps for the
  primitives (`writeString` = u32 len + bytes, PODs little-endian) and `BookMetadataCache` (book.bin).
- The per-book `statistics.bin` (magic `TATS`) is not in the upstream source I looked at; decoded by inspection.
- Verified by cross-checking: system totals (ms, page turns, sessions) = sum over the three finished books; they exclude
  Rogue Protocol (open at export time). `recent.bin` trailing f32 = progress fraction. Reading ms / page turns ≈ 46-70 s/page, plausible.
- `settings.bin` has the OPDS password in plaintext; `wifi.bin` has WiFi credentials. Tool redacts the former by default
  and never prints the latter. Don't commit raw exports.
- `book.bin` in the export is not truncated at 8192 for most books (that size was coincidence for one); parsed fully.
- Not decoded: `sections/N.bin` (laid-out page cache, first byte 0x36 = version 54, upstream is 75, so layouts differ),
  most of `settings.bin`, `progress.bin` bytes 6-7, several stats fields (see README).
- Design choice: decoder is a pure ES module (`x4.mjs`, Map<path, Uint8Array> in, JSON out) so a later frontend-only
  web tool can reuse it unchanged with a browser zip reader (e.g. fflate) in front.

## 2026-11-16 (later): dates
- Asked whether stats could hold timestamps. Scanned all state files for epoch-like values: only false positives (ASCII
  text such as "/Rog" = 1735348783 read as a u32). Found the firmware struct: matches this device is a CrossPoint fork
  (inx). `lastReadTimeMs = millis()`, i.e. uptime, not a date. Wall-clock `time()` is only stored for bookmarks/annotations.
- Corrected field labels: my "sessions" was chaptersRead, "tocCount" was sessionCount, "cumulativeBytes" was lastReadTimeMs
  (uptime), "spineBytes" was avgPageTimeMs. System totals confirm: [0..5] = started, finished, ms, pages, chapters, sessions.
- All export files share one mtime (copy time), so file mtimes are not usable from this export either.
- Other forks (CrossNext, Duet) advertise daily reading stats; not checked. Upstream CrossPoint issue #4359 mentions
  event timestamps in reading stats, so some firmware does record them.
