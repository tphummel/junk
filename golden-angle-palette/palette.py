#!/usr/bin/env python3
"""Golden-angle color palette: one primary color -> primary / support / accent.

Algorithm (from the "golden ratio color palettes" poster):
  1. Pick a primary color.
  2. Accent  = primary hue rotated by the golden angle (360 - 360/1.618 = 137.5 deg).
  3. Support = primary with saturation reduced by ~60%.
"""
import colorsys
import json
import sys

PHI = 1.618
GOLDEN_ANGLE = 360 - 360 / PHI  # ~137.5
SUPPORT_SAT_REDUCTION = 0.60

# My choice of starting color (vermilion).
DEFAULT_PRIMARY = "E4572E"


def hex_to_hls(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)


def hls_to_hex(h, l, s):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, l, s)
    return "{:02X}{:02X}{:02X}".format(*(round(c * 255) for c in (r, g, b)))


def palette(primary, direction=1):
    """direction=+1 moves clockwise around the wheel, -1 counter-clockwise."""
    h, l, s = hex_to_hls(primary)
    accent = hls_to_hex(h + direction * GOLDEN_ANGLE / 360, l, s)
    support = hls_to_hex(h, l, s * (1 - SUPPORT_SAT_REDUCTION))
    return {"primary": primary.lstrip("#").upper(), "support": support, "accent": accent}


if __name__ == "__main__":
    start = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_PRIMARY
    direction = -1 if "--ccw" in sys.argv else 1
    p = palette(start, direction)
    if "--json" in sys.argv:
        print(json.dumps(p))
    else:
        print(f"golden angle: {GOLDEN_ANGLE:.1f} deg")
        for name, hx in p.items():
            print(f"{name:8s} #{hx}")
