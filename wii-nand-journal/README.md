# wii-nand-journal

Extract the Wii Message Board's play-history journal (per-session game
playtimes and board messages/milestones) from a raw NAND dump, in CSV,
TSV, or JSON.

Supports the "old BootMii" NAND dump format (exactly 553,649,152 bytes,
with an appended `keys.bin` blob containing the console's AES key) — the
most common format produced by BootMii's "backup NAND" feature.

## Install

```
cd wii-nand-journal
go build -o wii-journal .
```

(or run without building: `go run . ...`)

Zero third-party dependencies — everything is Go stdlib (`crypto/aes`,
`crypto/cipher`, `encoding/binary`, `net/http`, `encoding/csv`,
`encoding/json`).

## Usage

```
wii-journal nand.bin -o journal.csv
wii-journal nand.bin -o journal.json --format json
wii-journal nand.bin --offline              # skip GameTDB name lookup, no network
wii-journal nand.bin --refresh-titledb -o out.tsv --format tsv
```

Output rows are one of two types:

- `session` — a single game/channel play session: `game_code`,
  `game_name` (resolved via GameTDB, see below), `duration_seconds`,
  `duration_hms`, `date` (session start, UTC).
- `message` — a Message Board post/milestone: `title`, `body`,
  `edit_count`, `date` (last edit, UTC).

Every row also includes `vff_path` and `block_offset` for full-fidelity
traceability back to the source record inside the decrypted `cdb.vff`.

## Game name resolution

4-character game/channel codes (e.g. `RSBE`, `HACA`) are resolved to
human names via [GameTDB](https://www.gametdb.com)'s plaintext title
database, auto-downloaded and cached at
`~/.cache/wii-nand-journal/wiitdb.txt` (refreshed every 30 days, or force
with `--refresh-titledb`). Each resolved row includes a
`name_confidence` field:

- `exact_channel_match` — code matched a 4-char system channel ID exactly.
- `retail_01` — code matched a single unambiguous `<code>01` retail disc ID.
- `retail_01_ambiguous` — matched `<code>01`, but other 6-char IDs share
  the same 4-char prefix (usually ROM hacks/fan track packs sharing a
  game's base code) — the `01` retail entry is used as the best guess.
- `fallback_variant` — no `01` retail ID exists for this code; the first
  known variant was used (e.g. a PAL-region `8P` suffix) — least certain.
- `not_found` — no GameTDB entry for this code at all.

Playtime records only capture the 4-character game code, not the full
6-character disc ID (code + region/maker), so some ambiguity here is
inherent to the source data, not a limitation of this tool.

Use `--offline` to skip all network access and leave `game_name` blank.

## How it works

1. `nand.go` — parses the NAND's SFFS filesystem (superblock/FAT/FST),
   decrypts clusters with the console's embedded AES key, and extracts
   `/title/00000001/00000002/data/cdb.vff` (the System Menu's
   message-board data store).
2. `vff.go` — parses the VFF (FAT12/16) container and walks it for
   `CDBFILE` records, pulling playtime sessions out of `.ptm`
   attachments and message text out of `RIPLBoardRecord`s.
3. `titledb.go` — resolves game codes to names via GameTDB.
