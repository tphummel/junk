"""Per-state configuration: defaults.toml deep-merged with <ST>.toml, plus
thresholds derived from the final scale denominator."""

import copy
import math
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = ROOT / "config"
LETTER_CM = (21.59, 27.94)


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_state(code, config_dir=CONFIG_DIR):
    with open(config_dir / "defaults.toml", "rb") as f:
        base = tomllib.load(f)
    with open(config_dir / f"{code.upper()}.toml", "rb") as f:
        cfg = _merge(base, tomllib.load(f))
    w, h = cfg["map_trim_cm"]
    if max(w, h) > 18.0 or min(w, h) > 12.0:
        raise ValueError(f"{code}: map trim {w}x{h} cm exceeds 18 x 12 cm")
    expected = "portrait" if h > w else "landscape"
    if cfg["orientation"] != expected:
        raise ValueError(f"{code}: orientation {cfg['orientation']} != trim {w}x{h}")
    return cfg


def enabled_states(config_dir=CONFIG_DIR):
    codes = []
    for p in sorted(config_dir.glob("*.toml")):
        if p.stem == "defaults":
            continue
        with open(p, "rb") as f:
            if tomllib.load(f).get("enabled", False):
                codes.append(p.stem)
    return codes


def fit_scale(bounds, trim_cm, padding_percent, step):
    """Smallest scale denominator (rounded up to `step`) that fits the
    projected bounds inside the trim with `padding_percent` total padding."""
    minx, miny, maxx, maxy = bounds
    usable = 1 - padding_percent / 100.0
    sx = (maxx - minx) / (trim_cm[0] / 100.0 * usable)
    sy = (maxy - miny) / (trim_cm[1] / 100.0 * usable)
    return int(math.ceil(max(sx, sy) / step) * step)


def derive_thresholds(cfg, scale):
    """Fill threshold defaults from the plan's scale formulas."""
    t = dict(cfg["thresholds"])
    t.setdefault("min_road_length_m", round(0.001 * scale, -2))
    t.setdefault("simplification_m", round(max(50, min(2000, 0.0002 * scale)), -1))
    t.setdefault("label_spacing_m", round(0.02 * scale, -3))
    return t
