"""python -m usmaps build [ST ...] | --all"""

import argparse
import sys

from .build import build_state
from .config import enabled_states


def main(argv=None):
    ap = argparse.ArgumentParser(prog="usmaps")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build one or more states")
    b.add_argument("states", nargs="*", help="state codes, e.g. DE PA")
    b.add_argument("--all", action="store_true", help="every enabled state in config/")
    b.add_argument("--strict", action="store_true", help="exit non-zero on any failed QA check")
    args = ap.parse_args(argv)

    codes = enabled_states() if args.all else [s.upper() for s in args.states]
    if not codes:
        ap.error("no states given")
    failed = []
    for code in codes:
        _, checks = build_state(code)
        if any(c["status"] == "fail" for c in checks):
            failed.append(code)
    if failed:
        print(f"QA failures in: {', '.join(failed)}")
        if args.strict:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
