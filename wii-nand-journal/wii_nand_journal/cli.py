"""
wii-journal: extract the Wii Message Board's play-history journal
(game sessions + board messages/milestones) from a raw NAND dump.

    wii-journal nand.bin -o journal.csv
    wii-journal nand.bin -o journal.json --format json
    wii-journal nand.bin --offline            # skip GameTDB name resolution
"""
import argparse
import csv
import datetime
import json
import sys

from .nand import WiiNand, WiiNandError
from .vff import VFFVolume, VFFError, extract_cdb_records, parse_playtime_logs
from .titledb import TitleDB, ensure_titledb

CDB_VFF_PATH = "/title/00000001/00000002/data/cdb.vff"

COLUMNS = [
    "type",  # session | message
    "date",  # ISO8601 UTC
    "game_code",
    "game_name",
    "name_confidence",
    "duration_seconds",
    "duration_hms",
    "title",
    "body",
    "edit_count",
    "vff_path",
    "block_offset",
]


def fmt_hms(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def load_cdb_vff(nand_path, cdb_path):
    with WiiNand(nand_path) as nand:
        fst = nand.find(cdb_path)
        if fst is None:
            raise WiiNandError(f"{cdb_path} not found in this NAND dump")
        if not nand.is_file(fst):
            raise WiiNandError(f"{cdb_path} is not a file")
        return nand.get_file_data(fst)


def build_rows(vol, titledb):
    rows = []

    for e in parse_playtime_logs(vol):
        name, confidence, variants = (None, "offline", 0)
        if titledb is not None:
            name, confidence, variants = titledb.resolve(e["game_code"])
        rows.append(
            {
                "type": "session",
                "date": e["date"].isoformat(),
                "game_code": e["game_code"],
                "game_name": name or "",
                "name_confidence": confidence,
                "duration_seconds": e["duration_seconds"],
                "duration_hms": fmt_hms(e["duration_seconds"]),
                "title": "",
                "body": "",
                "edit_count": "",
                "vff_path": e["vff_path"],
                "block_offset": hex(e["block_offset"]),
            }
        )

    for r in extract_cdb_records(vol):
        if r["description"] != "ripl_board_record":
            continue
        if not r["message_title"] and not r["body_excerpt"]:
            continue
        rows.append(
            {
                "type": "message",
                "date": r["date"].isoformat(),
                "game_code": "",
                "game_name": "",
                "name_confidence": "",
                "duration_seconds": "",
                "duration_hms": "",
                "title": r["message_title"] or "",
                "body": r["body_excerpt"] or "",
                "edit_count": r["edit_count"],
                "vff_path": r["path"],
                "block_offset": "",
            }
        )

    rows.sort(key=lambda row: row["date"])
    return rows


def write_output(rows, fmt, out_fh):
    if fmt == "json":
        json.dump(rows, out_fh, indent=2, ensure_ascii=False)
        out_fh.write("\n")
        return
    delimiter = "\t" if fmt == "tsv" else ","
    writer = csv.DictWriter(out_fh, fieldnames=COLUMNS, delimiter=delimiter, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="wii-journal",
        description="Extract the Wii Message Board play-history journal from a raw NAND dump.",
    )
    parser.add_argument("nand_bin", help="path to a raw nand.bin dump (old-BootMii format, 553649152 bytes)")
    parser.add_argument("-o", "--output", help="output file path (default: stdout)")
    parser.add_argument(
        "-f", "--format", choices=["csv", "tsv", "json"], default=None,
        help="output format (default: inferred from --output extension, else csv)",
    )
    parser.add_argument(
        "--cdb-path", default=CDB_VFF_PATH,
        help=f"VFF path inside the NAND to read (default: {CDB_VFF_PATH})",
    )
    parser.add_argument(
        "--titledb", help="path to a local wiitdb.txt (default: auto-download/cache from GameTDB)"
    )
    parser.add_argument(
        "--refresh-titledb", action="store_true", help="force re-download of the GameTDB cache"
    )
    parser.add_argument(
        "--offline", action="store_true",
        help="skip game name resolution entirely (no network access, game_name left blank)",
    )
    parser.add_argument(
        "--dump-vff", metavar="PATH", help="also write the raw decrypted cdb.vff to PATH, for debugging"
    )
    args = parser.parse_args(argv)

    fmt = args.format
    if fmt is None:
        if args.output:
            ext = args.output.rsplit(".", 1)[-1].lower()
            fmt = ext if ext in ("csv", "tsv", "json") else "csv"
        else:
            fmt = "csv"

    try:
        vff_bytes = load_cdb_vff(args.nand_bin, args.cdb_path)
    except (WiiNandError, FileNotFoundError) as e:
        print(f"error reading NAND dump: {e}", file=sys.stderr)
        return 1

    if args.dump_vff:
        with open(args.dump_vff, "wb") as fh:
            fh.write(vff_bytes)

    try:
        vol = VFFVolume(vff_bytes)
    except VFFError as e:
        print(f"error parsing cdb.vff: {e}", file=sys.stderr)
        return 1

    titledb = None
    if not args.offline:
        try:
            path = ensure_titledb(cache_path=args.titledb, refresh=args.refresh_titledb)
            titledb = TitleDB(path)
        except Exception as e:
            print(f"warning: could not load GameTDB title database ({e}); game names will be blank", file=sys.stderr)

    rows = build_rows(vol, titledb)

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as fh:
            write_output(rows, fmt, fh)
        print(f"wrote {len(rows)} rows to {args.output}", file=sys.stderr)
    else:
        write_output(rows, fmt, sys.stdout)

    return 0


if __name__ == "__main__":
    sys.exit(main())
