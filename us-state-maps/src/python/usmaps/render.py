"""Vector grayscale PDF rendering with matplotlib: the map-only trim PDF and
the US Letter proof sheet with the legend outside the trim."""

import math

import matplotlib
import shapely

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import patheffects  # noqa: E402
from matplotlib.collections import LineCollection, PathCollection  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import FancyArrow, Rectangle  # noqa: E402
from matplotlib.path import Path as MPath  # noqa: E402

from .config import LETTER_CM  # noqa: E402
from .labels import PT_TO_MM, symbol_mm  # noqa: E402

MM_TO_PT = 1 / PT_TO_MM
CREDIT = "Map data © OpenStreetMap contributors"

matplotlib.rcParams.update({
    "pdf.fonttype": 42,          # embed TrueType, keep text as text
    "svg.fonttype": "none",
    "path.simplify": False,
})


def gray(v):
    return (v, v, v)


def _poly_path(poly):
    verts, codes = [], []
    for ring in [poly.exterior, *poly.interiors]:
        c = list(ring.coords)
        verts += c
        codes += [MPath.MOVETO] + [MPath.LINETO] * (len(c) - 2) + [MPath.CLOSEPOLY]
    return MPath(verts, codes)


def _polys(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [p for g in getattr(geom, "geoms", []) for p in _polys(g)]


def _segments(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [list(geom.coords)]
    if geom.geom_type in ("Polygon",):
        return [list(r.coords) for r in [geom.exterior, *geom.interiors]]
    return [s for g in getattr(geom, "geoms", []) for s in _segments(g)]


def fill(ax, geoms, face, edge="none", lw=0.0, z=1):
    paths = [_poly_path(p) for g in geoms for p in _polys(g)]
    if paths:
        ax.add_collection(PathCollection(paths, facecolors=[face], edgecolors=edge,
                                         linewidths=lw, zorder=z))


def stroke(ax, geoms, color, lw, z):
    segs = [s for g in geoms for s in _segments(g)]
    if segs:
        ax.add_collection(LineCollection(segs, colors=[color], linewidths=lw, zorder=z,
                                         capstyle="round", joinstyle="round"))


def halo(width_mm):
    return [patheffects.withStroke(linewidth=2 * width_mm * MM_TO_PT, foreground="white")]


def draw_map(ax, cfg, frame, layers, labels):
    """Draw into `ax`, whose box is exactly the trim."""
    st = cfg["style"]
    xmin, ymin, xmax, ymax = frame["extent"]
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)
    ax.set_axis_off()
    ax.patch.set_facecolor("white")

    k = frame["scale"] / 1000.0  # metres per paper mm

    fill(ax, layers["parks"].geometry, gray(st["park_fill_gray"]), z=1)
    water = list(layers["water"].geometry)
    fill(ax, water, gray(st["water_fill_gray"]), z=2)
    if water:
        # Outline only real shorelines, not the artificial cut at the legal line.
        legal_edge = layers["legal"].boundary.buffer(0.2 * k)
        edges = shapely.unary_union([w.boundary for w in water]).difference(legal_edge)
        stroke(ax, [edges], gray(st["water_line_gray"]), st["water_line_width_pt"], 3)
    stroke(ax, layers["rivers"].geometry, gray(st["water_line_gray"]), st["river_width_pt"], 3)

    hw = layers["highways"]
    stroke(ax, hw[hw["highway_class"] == "major_state_route"].geometry, "black",
           st["state_route_width_pt"], 4)
    stroke(ax, hw[hw["highway_class"] == "interstate"].geometry, "black",
           st["interstate_width_pt"], 5)
    stroke(ax, [layers["outline"].boundary], "black", st["boundary_width_pt"], 6)

    # City symbols (only for labelled cities), white halo via edge.
    places = layers["places"]
    for _, r in places[places["labelled"]].iterrows():
        smm = symbol_mm(r["tier"], st)
        marker = "s" if r["tier"] == "capital" else "o"
        ax.plot([r.geometry.x], [r.geometry.y], marker=marker, color="black",
                markersize=smm * MM_TO_PT, markeredgecolor="white",
                markeredgewidth=2 * st["symbol_halo_mm"] * MM_TO_PT, zorder=7)

    for lab in labels:
        ax.text(xmin + lab["x"] * k, ymin + lab["y"] * k, lab["text"],
                fontsize=lab["size_pt"], family=st["font_family"], color="black",
                ha="center", va="center", rotation=lab["angle"], rotation_mode="anchor",
                path_effects=halo(lab["halo_mm"]), zorder=8, clip_on=True)
    for coll in ax.collections:
        coll.set_clip_on(True)


def map_figure(cfg, frame, layers, labels):
    w_cm, h_cm = cfg["map_trim_cm"]
    fig = plt.figure(figsize=(w_cm / 2.54, h_cm / 2.54))
    ax = fig.add_axes((0, 0, 1, 1))
    draw_map(ax, cfg, frame, layers, labels)
    return fig


def nice_scalebar(scale, target_mm=30):
    """Round ground length (km) whose bar is close to target_mm on paper."""
    km = target_mm / 1000.0 * scale / 1000.0
    p = 10 ** math.floor(math.log10(km))
    for m in (5, 2, 1):
        if m * p <= km:
            return m * p
    return p


def draw_legend(fig, cfg, frame, box_cm):
    """Legend in figure cm coordinates (origin top-left, like the plan)."""
    st = cfg["style"]
    fs = st["legend_text_pt"]
    page_w, page_h = LETTER_CM
    x0, y0, w, h = box_cm
    ax = fig.add_axes((x0 / page_w, 1 - (y0 + h) / page_h, w / page_w, h / page_h))
    ax.set_xlim(0, w * 10)
    ax.set_ylim(h * 10, 0)  # mm, y down
    ax.set_axis_off()
    ax.add_patch(Rectangle((0, 0), w * 10, h * 10, fill=False, lw=0.3, ec=gray(0.4),
                           clip_on=False))
    txt = dict(fontsize=fs, family=st["font_family"], va="center", color="black")

    col_w = w * 10 / 3
    row = 4.0
    top = 3.5
    items = [
        [("line", st["interstate_width_pt"], "Interstate"),
         ("line", st["state_route_width_pt"], "Major state route")],
        [("capital", None, "State capital"), ("city", None, "City")],
        [("fill", st["water_fill_gray"], "Water"),
         ("fill", st["park_fill_gray"], "Park / protected area")],
    ]
    for c, col in enumerate(items):
        x = 3 + c * col_w
        for r, (kind, v, label) in enumerate(col):
            y = top + r * row
            if kind == "line":
                ax.add_line(Line2D([x, x + 5.5], [y, y], color="black", lw=v,
                                   solid_capstyle="butt"))
            elif kind == "fill":
                ec = gray(st["water_line_gray"]) if label == "Water" else "none"
                lw = st["water_line_width_pt"] if label == "Water" else 0
                ax.add_patch(Rectangle((x, y - 1.2), 5.5, 2.4, fc=gray(v), ec=ec, lw=lw))
            else:
                smm = st["capital_symbol_mm"] if kind == "capital" else st["medium_city_symbol_mm"]
                ax.plot([x + 2.75], [y], marker="s" if kind == "capital" else "o",
                        color="black", markersize=smm * MM_TO_PT, markeredgewidth=0)
            ax.text(x + 7, y, label, **txt)

    # Scale bar, bottom-left
    km = nice_scalebar(frame["scale"])
    bar_mm = km * 1e6 / frame["scale"]
    by = h * 10 - 6.0
    for i in range(2):
        ax.add_patch(Rectangle((3 + i * bar_mm / 2, by - 0.6), bar_mm / 2, 1.2,
                               fc="black" if i == 0 else "white", ec="black", lw=0.3))
    for frac, lbl in ((0, "0"), (0.5, f"{km / 2:g}"), (1, f"{km:g} km")):
        ax.text(3 + frac * bar_mm, by + 2.0, lbl, ha="center", **txt)
    ax.text(3 + bar_mm + 3, by, f"Scale 1:{frame['scale']:,}", **txt)

    # North arrow (grid north), bottom-right
    ax.add_patch(FancyArrow(w * 10 - 5, by + 1.5, 0, -4.0, width=0.3, head_width=1.6,
                            head_length=1.6, fc="black", ec="black",
                            length_includes_head=True))
    ax.text(w * 10 - 5, by - 3.8, "N", ha="center", **{**txt, "va": "bottom"})

    ax.text(w * 10 / 2 + 8, h * 10 - 2.0, CREDIT, ha="center", **txt)
    return ax


def crop_marks(fig, map_cm, length_mm=3.0, gap_mm=1.0):
    page_w, page_h = LETTER_CM
    ax = fig.add_axes((0, 0, 1, 1), zorder=-1)
    ax.set_xlim(0, page_w * 10)
    ax.set_ylim(page_h * 10, 0)
    ax.set_axis_off()
    x, y, w, h = [v * 10 for v in map_cm]
    for cx in (x, x + w):
        for cy in (y, y + h):
            sx = -1 if cx == x else 1
            sy = -1 if cy == y else 1
            ax.add_line(Line2D([cx + sx * gap_mm, cx + sx * (gap_mm + length_mm)], [cy, cy],
                               color="black", lw=0.25))
            ax.add_line(Line2D([cx, cx], [cy + sy * gap_mm, cy + sy * (gap_mm + length_mm)],
                               color="black", lw=0.25))


def letter_figure(cfg, frame, layers, labels):
    page_w, page_h = LETTER_CM
    lay = cfg["letter_layout"]
    w_cm, h_cm = cfg["map_trim_cm"]
    fig = plt.figure(figsize=(page_w / 2.54, page_h / 2.54))
    map_cm = (lay["map_x_cm"], lay["map_y_cm"], w_cm, h_cm)
    crop_marks(fig, map_cm)
    ax = fig.add_axes((map_cm[0] / page_w, 1 - (map_cm[1] + h_cm) / page_h,
                       w_cm / page_w, h_cm / page_h))
    draw_map(ax, cfg, frame, layers, labels)
    draw_legend(fig, cfg, frame, (lay["legend_x_cm"], lay["legend_y_cm"],
                                  lay["legend_width_cm"], lay["legend_height_cm"]))
    return fig, map_cm
