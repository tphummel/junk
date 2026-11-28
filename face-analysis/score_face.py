#!/usr/bin/env python3
"""Score a face-analysis JSON result from 0 to 100 against a personal "perfect" target.

Runs offline on the JSON that `analyze_face.py` or the HTTP API produces; it is not part of
the service. Perfect (100) means: head pose at 0/0/0 degrees, a neutral expression, and no
facial hair. The score is the weighted mean of those three parts, each 0-100.

Usage:
    python score_face.py analysis.json [more.json ...]
    python score_face.py analysis.json --json
    python score_face.py analysis.json --log scores.csv --date 2026-11-28
"""
import argparse
import csv
import json
import sys
from datetime import date
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


def append_log(path, day, name, scored):
    path = Path(path)
    new = not path.exists()
    with path.open("a", newline="") as fh:
        writer = csv.writer(fh)
        if new:
            writer.writerow(["date", "file", "total", "pose", "expression", "facial_hair"])
        parts = scored["parts"]
        writer.writerow([day, name, f"{scored['total']:.1f}", f"{parts['pose']['score']:.1f}",
                         f"{parts['expression']['score']:.1f}", f"{parts['facial_hair']['score']:.1f}"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="+", help="analysis JSON file(s)")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--log", metavar="CSV", help="append a row per file to this CSV")
    parser.add_argument("--date", default=date.today().isoformat(), help="date for --log (default today)")
    args = parser.parse_args(argv)

    status = 0
    out = {}
    for f in args.files:
        try:
            scored = score_result(json.loads(Path(f).read_text()))
        except (OSError, ValueError) as exc:
            print(f"{f}: {exc}", file=sys.stderr)
            status = 1
            continue
        out[f] = scored
        if not args.json:
            print(format_report(f, scored))
        if args.log:
            append_log(args.log, args.date, Path(f).name, scored)
    if args.json:
        print(json.dumps(out, indent=2))
    return status


if __name__ == "__main__":
    sys.exit(main())
