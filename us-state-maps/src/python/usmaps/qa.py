"""Automated QA checks and the per-state QA report."""

import itertools

import numpy as np
import shapely
from pypdf import PdfReader
from pyproj import CRS, Proj, Transformer

from .config import LETTER_CM
from .georef import has_viewport
from .render import CREDIT


def scale_error(outline, crs, n=40):
    """Point-scale factor k sampled on a grid inside the state (conformal
    projections: k is the same in all directions)."""
    crs = CRS.from_user_input(crs)
    proj = Proj(crs)
    to_ll = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    minx, miny, maxx, maxy = outline.bounds
    xs, ys = np.meshgrid(np.linspace(minx, maxx, n), np.linspace(miny, maxy, n))
    pts = [(x, y) for x, y in zip(xs.ravel(), ys.ravel())
           if outline.contains(shapely.Point(x, y))]
    lon, lat = to_ll.transform([p[0] for p in pts], [p[1] for p in pts])
    k = np.asarray(proj.get_factors(lon, lat).meridional_scale)
    return {"k_min": round(float(k.min()), 6), "k_max": round(float(k.max()), 6),
            "max_abs_error": round(float(np.abs(k - 1).max()), 6), "samples": len(pts)}


def page_size_cm(pdf_path):
    box = PdfReader(pdf_path).pages[0].mediabox
    return float(box.width) / 72 * 2.54, float(box.height) / 72 * 2.54


def run_checks(cfg, frame, layers, labels, paths, scale_err):
    lim, st, t = cfg["limits"], cfg["style"], frame["thresholds"]
    checks = []

    def check(section, name, ok, detail=""):
        checks.append({"section": section, "check": name,
                       "status": "warn" if ok is None else ("pass" if ok else "fail"),
                       "detail": detail})

    w, h = cfg["map_trim_cm"]
    pw, ph = page_size_cm(paths["map_pdf"])
    check("Scale and projection", "Map-only PDF is exactly the trim",
          abs(pw - w) < 0.01 and abs(ph - h) < 0.01, f"{pw:.2f} x {ph:.2f} cm")
    check("Scale and projection", f"Orientation is {cfg['orientation']}",
          (ph > pw) == (cfg["orientation"] == "portrait"))
    check("Scale and projection", "Map fits within 18 x 12 cm",
          max(pw, ph) <= 18.001 and min(pw, ph) <= 12.001)
    lo, hi = cfg["scale_band"]
    check("Scale and projection", "Scale within target band",
          True if lo <= frame["scale"] <= hi else None,
          f"1:{frame['scale']:,} (target 1:{lo:,}-1:{hi:,})")
    err = scale_err["max_abs_error"]
    check("Scale and projection", "Scale error within target",
          True if err <= lim["max_scale_error"] else (None if err <= lim["max_scale_error_hard"] else False),
          f"max |k-1| = {err * 100:.3f}% over {scale_err['samples']} samples")
    xmin, ymin, xmax, ymax = frame["extent"]
    ob = layers["outline"].bounds
    cx_off = ((ob[0] + ob[2]) - (xmin + xmax)) / 2 / frame["scale"] * 1000
    cy_off = ((ob[1] + ob[3]) - (ymin + ymax)) / 2 / frame["scale"] * 1000
    check("Scale and projection", "State is centred in the frame",
          abs(cx_off) < 0.1 and abs(cy_off) < 0.1, f"offset {cx_off:.2f}, {cy_off:.2f} mm")
    check("Scale and projection", "State is inside the trim",
          shapely.box(*frame["extent"]).contains(layers["outline"]))
    check("Scale and projection", "Map-only PDF is georeferenced", has_viewport(paths["map_pdf"]))

    hw = layers["highways"]
    shown = hw[hw["highway_class"].isin(["interstate", "major_state_route"])]
    routes = set(shown["route"])
    check("Roads", "Interstates are present", (hw["highway_class"] == "interstate").any(),
          ", ".join(sorted(hw.loc[hw["highway_class"] == "interstate", "route"])))
    for r in cfg["acceptance"].get("interstates", []):
        check("Roads", f"{r} present", r in routes)
    check("Roads", "Interstates thicker than state routes",
          st["interstate_width_pt"] > st["state_route_width_pt"])
    check("Roads", "Major state routes are present",
          True if (hw["highway_class"] == "major_state_route").any() else None,
          ", ".join(sorted(hw.loc[hw["highway_class"] == "major_state_route", "route"])))
    check("Roads", "No US numbered highways", not any(r.startswith("US-") for r in routes))
    check("Roads", "No duplicate route fragments", not shown["route"].duplicated().any())

    city_labels = [l for l in labels if l["kind"] == "city"]
    names = {l["text"] for l in city_labels}
    cap = [l for l in city_labels if l.get("tier") == "capital"]
    check("Cities", "State capital labelled with distinct symbol",
          len(cap) == 1 and cap[0]["text"] == cfg["capital"], cfg["capital"])
    for c in cfg["acceptance"].get("cities", []):
        check("Cities", f"{c} labelled", c in names)
    check("Cities", "City labels within maximum",
          len(city_labels) <= t["max_city_labels"],
          f"{len(city_labels)} of max {t['max_city_labels']}: " + ", ".join(l["text"] for l in city_labels))
    overlaps = [(a["text"], b["text"]) for a, b in itertools.combinations(labels, 2)
                if a["box"].intersects(b["box"])]
    check("Cities", "No overlapping labels", not overlaps, "; ".join(f"{a}/{b}" for a, b in overlaps))
    small = [l["text"] for l in labels
             if l["size_pt"] < (lim["min_state_route_label_pt"] if l["kind"] == "state_route"
                                else lim["min_label_pt"])]
    check("Cities", "All labels at or above minimum size", not small, ", ".join(small))

    check("Water", "Major water present", len(layers["water"]) + len(layers["rivers"]) > 0,
          f"{len(layers['water'])} areas; rivers: " + ", ".join(sorted(layers["rivers"]["name"])))
    check("Water", "Water lighter than parks", st["water_fill_gray"] > st["park_fill_gray"])
    check("Parks", "Parks present (context only, unlabelled)",
          True if len(layers["parks"]) else None, f"{len(layers['parks'])} areas")

    lay = cfg["letter_layout"]
    map_box = shapely.box(lay["map_x_cm"], lay["map_y_cm"],
                          lay["map_x_cm"] + w, lay["map_y_cm"] + h)
    leg_box = shapely.box(lay["legend_x_cm"], lay["legend_y_cm"],
                          lay["legend_x_cm"] + lay["legend_width_cm"],
                          lay["legend_y_cm"] + lay["legend_height_cm"])
    safe = shapely.box(0.3, 0.3, LETTER_CM[0] - 0.3, LETTER_CM[1] - 0.3)
    check("Legend", "Legend is outside the map trim", not leg_box.intersects(map_box))
    check("Legend", "Map and legend inside 3 mm safe margin",
          safe.contains(map_box) and safe.contains(leg_box))
    lw, lh = page_size_cm(paths["letter_pdf"])
    check("Legend", "Letter page is 21.59 x 27.94 cm",
          abs(lw - LETTER_CM[0]) < 0.01 and abs(lh - LETTER_CM[1]) < 0.01)
    check("Legend", "Legend text at least 4.5 pt", st["legend_text_pt"] >= lim["min_legend_pt"])
    text = PdfReader(paths["letter_pdf"]).pages[0].extract_text()
    check("Legend", "OSM attribution present", "OpenStreetMap contributors" in text, CREDIT)
    check("Legend", "No state title",
          cfg["state_name"] not in [ln.strip() for ln in text.splitlines()])
    check("Legend", "Letter sheet map is georeferenced", has_viewport(paths["letter_pdf"]))
    return checks


MANUAL = {
    "Boundary": ["Boundary is clean, no slivers or gaps", "Coastline is clear where applicable"],
    "Roads": ["No spaghetti around urban interchanges", "Route labels are comfortable"],
    "Cities": ["No labels on dense interchange geometry", "White halos are clean"],
    "Water": ["Water does not overpower roads or labels"],
    "Parks": ["Park fill does not overpower highways"],
    "Print test": ["Thin lines hold at 100/200/400%", "Halo rendering", "Gray separation",
                   "Label readability", "Trim alignment", "Nothing important clipped"],
}


def write_report(path, cfg, manifest, checks):
    icon = {"pass": "[x]", "warn": "[~]", "fail": "[ ]"}
    counts = {s: sum(c["status"] == s for c in checks) for s in ("pass", "warn", "fail")}
    lines = [f"# {cfg['state_name']} ({cfg['state']}) QA report", "",
             f"- Build: `{manifest['build']['git_sha']}` at {manifest['build']['built_at']}",
             f"- Scale: 1:{manifest['approx_scale']:,}",
             f"- OSM data timestamp: {manifest['build']['osm_timestamp'] or 'unknown'}",
             f"- Automated checks: {counts['pass']} pass, {counts['warn']} warn, "
             f"{counts['fail']} fail", "",
             "Legend: `[x]` pass, `[~]` warn (needs a human look), `[ ]` fail.", ""]
    sections = list(dict.fromkeys([c["section"] for c in checks] + list(MANUAL)))
    for s in sections:
        lines.append(f"## {s}")
        lines.append("")
        for c in checks:
            if c["section"] == s:
                d = f" ({c['detail']})" if c["detail"] else ""
                lines.append(f"- {icon[c['status']]} {c['check']}{d}")
        for m in MANUAL.get(s, []):
            lines.append(f"- [ ] {m} *(manual)*")
        lines.append("")
    path.write_text("\n".join(lines))
