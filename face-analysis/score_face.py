#!/usr/bin/env python3
"""Score a face-analysis JSON result from 0 to 100 against a personal "perfect" target.

Runs offline on the JSON that `analyze_face.py` or the HTTP API produces; it is not part of
the service. Perfect (100) means: head pose at 0/0/0 degrees, a neutral expression, and no
facial hair. The score is the weighted mean of those three parts, each 0-100.

Usage:
    python score_face.py analysis.json                  # one file: full breakdown
    python score_face.py ~/faces/                       # a directory of daily JSON: trend by day
    python score_face.py ~/faces/ --log scores.csv      # also record per-file rows (idempotent)
    python score_face.py ~/faces/ --json

A day's date comes from a YYYY-MM-DD or YYYYMMDD in the file name, else the file's modified
date. Several files with the same date are summarized by their median.
"""
import argparse
import csv
import json
import re
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

# Weights of the three parts (normalized, so they need not sum to 1).
WEIGHTS = {"pose": 1.0, "expression": 1.0, "facial_hair": 1.0}

# Pose: full marks within POSE_FULL degrees of 0, falling linearly to zero at POSE_ZERO.
POSE_FULL = 2.0
POSE_ZERO = 15.0

# Expression: each blendshape is a 0-1 activation. Full marks at or below EXPR_FULL, falling
# linearly to zero at EXPR_ZERO. "Neutral" = every one of these near 0.
EXPR_FULL = 0.05
EXPR_ZERO = 0.5
NEUTRAL_BLENDSHAPES = {
    "smile": ["mouthSmileLeft", "mouthSmileRight"],
    "frown": ["mouthFrownLeft", "mouthFrownRight"],
    "mouth_open": ["jawOpen"],
    "pucker": ["mouthPucker"],
    "blink": ["eyeBlinkLeft", "eyeBlinkRight"],
    "squint": ["eyeSquintLeft", "eyeSquintRight"],
    "brow_down": ["browDownLeft", "browDownRight"],
}


def ramp(value, full, zero):
    """1.0 at or below `full`, 0.0 at or above `zero`, linear in between."""
    if value <= full:
        return 1.0
    if value >= zero:
        return 0.0
    return 1.0 - (value - full) / (zero - full)


def score_pose(result):
    pose = result.get("head_pose") or {}
    keys = ["pitch_degrees", "yaw_degrees", "roll_degrees"]
    parts = {k.split("_")[0]: ramp(abs(pose.get(k, 0.0)), POSE_FULL, POSE_ZERO) for k in keys}
    return 100 * sum(parts.values()) / len(parts), parts


def score_expression(result):
    shapes = result.get("blendshapes") or {}
    parts = {}
    for name, keys in NEUTRAL_BLENDSHAPES.items():
        present = [shapes[k] for k in keys if k in shapes]
        if present:
            parts[name] = ramp(sum(present) / len(present), EXPR_FULL, EXPR_ZERO)
    if not parts:
        raise ValueError("no blendshapes in result; cannot score expression")
    return 100 * sum(parts.values()) / len(parts), parts


def score_facial_hair(result):
    fh = result.get("facial_hair_indicators") or {}
    mustache = fh.get("mustache_probability", 0.0)
    beard = fh.get("beard_probability", 0.0)
    parts = {"mustache": 1.0 - mustache, "beard": 1.0 - beard}
    return 100 * sum(parts.values()) / len(parts), parts


def score_result(result):
    """Return {"total": float, "parts": {name: {"score": float, "detail": {...}}}}."""
    if not result.get("face_detected"):
        raise ValueError(result.get("error") or "no face detected")
    scorers = {"pose": score_pose, "expression": score_expression, "facial_hair": score_facial_hair}
    parts = {}
    for name, fn in scorers.items():
        value, detail = fn(result)
        parts[name] = {"score": value, "detail": {k: 100 * v for k, v in detail.items()}}
    total_weight = sum(WEIGHTS.values())
    total = sum(parts[n]["score"] * WEIGHTS[n] for n in parts) / total_weight
    return {"total": total, "parts": parts}


def format_report(name, scored):
    lines = [f"{name}: {scored['total']:.1f} / 100"]
    for part, info in scored["parts"].items():
        detail = ", ".join(f"{k} {v:.0f}" for k, v in info["detail"].items())
        lines.append(f"  {part:<12} {info['score']:5.1f}   ({detail})")
    return "\n".join(lines)


DATE_RE = re.compile(r"(\d{4})-?(\d{2})-?(\d{2})")


def expand(paths):
    """Files as given; a directory contributes its *.json files, sorted."""
    files = []
    for p in map(Path, paths):
        files.extend(sorted(p.glob("*.json")) if p.is_dir() else [p])
    return files


def date_of(path):
    m = DATE_RE.search(path.name)
    if m:
        try:
            return datetime(*map(int, m.groups())).date().isoformat()
        except ValueError:
            pass
    return datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()


def append_log(path, rows):
    """Append (date, file, scored) rows to a CSV, skipping (date, file) pairs already there."""
    path = Path(path)
    seen = set()
    if path.exists():
        with path.open(newline="") as fh:
            seen = {(r["date"], r["file"]) for r in csv.DictReader(fh)}
    new = not path.exists()
    with path.open("a", newline="") as fh:
        writer = csv.writer(fh)
        if new:
            writer.writerow(["date", "file", "total", "pose", "expression", "facial_hair"])
        for day, name, scored in rows:
            if (day, name) in seen:
                continue
            parts = scored["parts"]
            writer.writerow([day, name, f"{scored['total']:.1f}", f"{parts['pose']['score']:.1f}",
                             f"{parts['expression']['score']:.1f}", f"{parts['facial_hair']['score']:.1f}"])


def summarize_days(rows):
    """Median score per day -> [{date, shots, total, pose, expression, facial_hair}], by date."""
    by_day = {}
    for day, _, scored in rows:
        by_day.setdefault(day, []).append(scored)
    days = []
    for day in sorted(by_day):
        shots = by_day[day]
        entry = {"date": day, "shots": len(shots),
                 "total": statistics.median(x["total"] for x in shots)}
        for part in WEIGHTS:
            entry[part] = statistics.median(x["parts"][part]["score"] for x in shots)
        days.append(entry)
    return days


def format_trend(days):
    lines = [f"{'date':<11}{'shots':>5}{'total':>8}{'pose':>7}{'expr':>7}{'hair':>7}"]
    for d in days:
        lines.append(f"{d['date']:<11}{d['shots']:>5}{d['total']:>8.1f}{d['pose']:>7.1f}"
                     f"{d['expression']:>7.1f}{d['facial_hair']:>7.1f}")
    totals = [d["total"] for d in days]
    best = max(days, key=lambda d: d["total"])
    summary = [f"days: {len(days)}   latest: {totals[-1]:.1f}   best: {best['total']:.1f} ({best['date']})"]
    if len(days) > 1:
        summary.append(f"change since first day: {totals[-1] - totals[0]:+.1f}")
    if len(days) >= 7:
        summary.append(f"last 7 days avg: {statistics.mean(totals[-7:]):.1f}")
    return "\n".join(lines + ["", "   ".join(summary)])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("paths", nargs="+", help="analysis JSON file(s) and/or directories of them")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--log", metavar="CSV", help="append per-file rows to this CSV (skips ones already logged)")
    args = parser.parse_args(argv)

    files = expand(args.paths)
    if not files:
        print("no JSON files found", file=sys.stderr)
        return 1

    status = 0
    rows = []
    for f in files:
        try:
            rows.append((date_of(f), f.name, score_result(json.loads(f.read_text())), str(f)))
        except (OSError, ValueError) as exc:
            print(f"{f}: {exc}", file=sys.stderr)
            status = 1
    if not rows:
        return 1

    if args.log:
        append_log(args.log, [(d, n, s) for d, n, s, _ in rows])

    single = len(rows) == 1 and not Path(args.paths[0]).is_dir()
    if args.json:
        out = {"files": {path: {"date": d, "score": s} for d, _, s, path in rows}}
        if not single:
            out["days"] = summarize_days([(d, n, s) for d, n, s, _ in rows])
        print(json.dumps(out, indent=2))
    elif single:
        print(format_report(rows[0][3], rows[0][2]))
    else:
        print(format_trend(summarize_days([(d, n, s) for d, n, s, _ in rows])))
    return status


if __name__ == "__main__":
    sys.exit(main())
