# wii-nand-journal

Extract the Wii Message Board's play-history journal (per-session game
playtimes and board messages/milestones) from a raw NAND dump, in CSV,
TSV, or JSON.

Supports the "old BootMii" NAND dump format (exactly 553,649,152 bytes,
with an appended `keys.bin` blob containing the console's AES key) — the
most common format produced by BootMii's "backup NAND" feature.

Fully offline: no network access, no external title database. Every
value — game name, title ID, console ID — comes from data the console
itself embedded in the NAND at logging time, the same data the Wii's
own Message Board UI reads to display session history.

## Install

```
cd wii-nand-journal
go build -o wii-journal .
```

(or run without building: `go run . ...`)

Zero dependencies, third-party or otherwise — everything is Go stdlib
(`crypto/aes`, `crypto/cipher`, `encoding/binary`, `encoding/csv`,
`encoding/json`).

## Usage

```
wii-journal nand.bin -o journal.csv
wii-journal nand.bin -o journal.json --format json
wii-journal nand.bin --format tsv
```

Output rows are one of two types:

- `session` — a single game/channel play session: `game_code` (4-char),
  `title_id` (full 6-char disc/channel ID, e.g. `RSBE01`), `game_name`
  (as authored by the game/channel itself), `duration_seconds`,
  `duration_hms`, `date` (session start, UTC).
- `message` — a Message Board post/milestone: `title`, `body`,
  `edit_count`, `date` (last edit, UTC).

Every row also includes `console_id` (the source Wii's system ID) and
`vff_path`/`block_offset` for full-fidelity traceability back to the
source record inside the decrypted `cdb.vff`.

## Why no title database

Earlier versions of this tool only captured the 4-character game code
from playtime records and resolved names via GameTDB — an external,
community-maintained database. That's a lossy approach: the 4-char
code alone is genuinely ambiguous (e.g. `RSBE` matches dozens of
`Super Smash Bros. Brawl` ROM hacks in GameTDB, not just the retail
game), so name resolution needed a confidence tier and could still get
it wrong.

It turns out the console never stores an ambiguous code. Each `.ptm`
session entry embeds, at logging time:

- the full 6-character title ID (game code + maker/region suffix) at
  offset `+0x70`, not just the 4-character code, and
- the game's own display name (UTF-16BE, from the game/channel's own
  banner metadata) at offset `+0x0C`.

This is the exact same data the Wii's own Message Board reads to show
session history, so reading it directly is both simpler and more
accurate than guessing from an external database.

## How it works

1. `nand.go` — parses the NAND's SFFS filesystem (superblock/FAT/FST),
   decrypts clusters with the console's embedded AES key, and extracts
   `/title/00000001/00000002/data/cdb.vff` (the System Menu's
   message-board data store).
2. `vff.go` — parses the VFF (FAT12/16) container and walks it for
   `CDBFILE` records, pulling playtime sessions (title ID, embedded
   game name, duration) out of `.ptm` attachments and message text out
   of `RIPLBoardRecord`s.
