"""Priority label placement with collision removal, in paper millimetres.

Order (plan): capital -> large cities -> Interstate labels -> remaining cities
-> major state route labels. A label that cannot be placed comfortably is
dropped (and for a city, so is its symbol) rather than shrunk or forced."""

import math
from functools import lru_cache

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import shapely  # noqa: E402
from shapely import affinity  # noqa: E402

PT_TO_MM = 25.4 / 72.0

# (dx, dy) unit offsets, in preference order: right, upper-right, left, ...
CITY_POSITIONS = [(1, 0), (1, 1), (-1, 0), (1, -1), (0, 1), (-1, 1), (0, -1), (-1, -1)]


@lru_cache(maxsize=4096)
def text_size_mm(text, size_pt, family):
    """Rendered (width, height) in mm of a single-line label, as matplotlib
    lays it out (height includes ascent + descent)."""
    fig = plt.figure(figsize=(2, 2), dpi=288)
    t = fig.text(0, 0, text, fontsize=size_pt, family=family)
    bb = t.get_window_extent(renderer=fig.canvas.get_renderer())
    plt.close(fig)
    return bb.width / 288 * 25.4, bb.height / 288 * 25.4


def rect(cx, cy, w, h, angle_deg=0.0):
    r = shapely.box(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    return affinity.rotate(r, angle_deg, origin=(cx, cy)) if angle_deg else r


class Placer:
    def __init__(self, frame_mm, margin_mm, pad_mm, family):
        w, h = frame_mm
        self.inner = shapely.box(margin_mm, margin_mm, w - margin_mm, h - margin_mm)
        self.pad = pad_mm
        self.family = family
        self.obstacles = []  # label boxes and city symbols
        self.labels = []

    def fits(self, box):
        if not self.inner.contains(box):
            return False
        grown = box.buffer(self.pad, join_style="mitre")
        return not any(grown.intersects(o) for o in self.obstacles)

    def add(self, box, label):
        self.obstacles.append(box)
        self.labels.append(label)

    # -- cities --------------------------------------------------------------

    def place_city(self, name, x, y, symbol_mm, size_pt, halo_mm, roads_mm, force=False):
        w, h = text_size_mm(name, size_pt, self.family)
        w += 2 * halo_mm
        h += 2 * halo_mm * 0.5
        gap = symbol_mm / 2 + 0.5
        best = None
        for rank, (dx, dy) in enumerate(CITY_POSITIONS):
            cx = x + dx * (gap + w / 2)
            cy = y + dy * (gap + h / 2) if dx == 0 else y + dy * (gap * 0.7 + h / 2)
            box = rect(cx, cy, w, h)
            if not self.fits(box):
                continue
            # Prefer spots that cover the least road geometry (interchanges).
            cover = sum(box.intersection(g).length * wgt for g, wgt in roads_mm)
            score = cover + rank * 0.5
            if best is None or score < best[0]:
                best = (score, cx, cy, box, dx, dy)
        if best is None:
            if not force:
                return None
            cx, cy = x + gap + w / 2, y
            best = (0, cx, cy, rect(cx, cy, w, h), 1, 0)
        _, cx, cy, box, dx, dy = best
        label = {"kind": "city", "text": name, "x": cx, "y": cy, "angle": 0.0,
                 "size_pt": size_pt, "halo_mm": halo_mm, "box": box}
        self.add(box, label)
        return label

    def add_symbol(self, x, y, symbol_mm, halo_mm):
        self.obstacles.append(shapely.Point(x, y).buffer(symbol_mm / 2 + halo_mm))

    # -- routes --------------------------------------------------------------

    def place_route(self, text, lines_mm, kind, size_pt, halo_mm, offset_mm, min_len_mm):
        """Label along the longest comfortably straight run; fall back to a
        standing (horizontal) label near the route when it curves too much."""
        w, h = text_size_mm(text, size_pt, self.family)
        w += 2 * halo_mm
        h += halo_mm
        need = max(min_len_mm, w + 1.0)
        segs = []
        for line in lines_mm:
            simple = line.simplify(0.4)
            coords = list(simple.coords)
            for (x0, y0), (x1, y1) in zip(coords, coords[1:]):
                L = math.hypot(x1 - x0, y1 - y0)
                if L >= need:
                    segs.append((L, x0, y0, x1, y1))
        segs.sort(reverse=True)
        for L, x0, y0, x1, y1 in segs:
            ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
            # Keep text upright; near-vertical runs read bottom-to-top.
            if ang > 105:
                ang -= 180
            elif ang <= -75:
                ang += 180
            nx, ny = -math.sin(math.radians(ang)), math.cos(math.radians(ang))
            d = offset_mm + h / 2
            for f in (0.5, 0.35, 0.65, 0.2, 0.8):
                half = (w / 2) / L
                f = min(max(f, half), 1 - half)
                px, py = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
                cx, cy = px + nx * d, py + ny * d
                box = rect(cx, cy, w, h, ang)
                if self.fits(box):
                    label = {"kind": kind, "text": text, "x": cx, "y": cy, "angle": ang,
                             "size_pt": size_pt, "halo_mm": halo_mm, "box": box}
                    self.add(box, label)
                    return label
        # Standing label beside the midpoint of the longest part.
        longest = max(lines_mm, key=lambda l: l.length, default=None)
        if longest is None or longest.length < min_len_mm:
            return None
        p = longest.interpolate(0.5, normalized=True)
        for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            cx = p.x + dx * (w / 2 + offset_mm + 0.3)
            cy = p.y + dy * (h / 2 + offset_mm + 0.3)
            box = rect(cx, cy, w, h)
            if self.fits(box):
                label = {"kind": kind, "text": text, "x": cx, "y": cy, "angle": 0.0,
                         "size_pt": size_pt, "halo_mm": halo_mm, "box": box}
                self.add(box, label)
                return label
        return None


def to_mm(geom, frame):
    xmin, ymin = frame["extent"][:2]
    k = 1000.0 / frame["scale"]
    return affinity.affine_transform(geom, [k, 0, 0, k, -xmin * k, -ymin * k])


def lines_of(geom):
    if geom.geom_type == "LineString":
        return [geom]
    return [g for g in getattr(geom, "geoms", [])]


def symbol_mm(tier, style):
    return {"capital": style["capital_symbol_mm"], "large": style["large_city_symbol_mm"],
            "medium": style["medium_city_symbol_mm"]}.get(tier, style["small_city_symbol_mm"])


def place_labels(cfg, frame, places, highways):
    """Returns (labels, chosen_places_index). Coordinates are mm from the
    trim's lower-left corner."""
    st, t = cfg["style"], frame["thresholds"]
    placer = Placer(frame["trim_mm"], t["frame_margin_mm"], t["label_pad_mm"], st["font_family"])
    roads_mm = []
    for _, r in highways.iterrows():
        wgt = 2.0 if r["highway_class"] == "interstate" else 1.0
        roads_mm.append((to_mm(r.geometry, frame), wgt))

    pts = [(to_mm(p, frame), row) for p, (_, row) in zip(places.geometry, places.iterrows())]
    chosen = []

    def try_city(pt, row, force=False):
        if len(chosen) >= t["max_city_labels"] and not force:
            return
        for idx in chosen:
            q = pts[idx][0]
            if pt.distance(q) < t["min_city_spacing_mm"]:
                return
        smm = symbol_mm(row["tier"], st)
        # Symbol box must not sit on an existing label.
        sym = pt.buffer(smm / 2 + st["symbol_halo_mm"])
        if any(sym.intersects(l["box"]) for l in placer.labels) and not force:
            return
        if not placer.inner.contains(pt):
            return
        lab = placer.place_city(row["name"], pt.x, pt.y, smm, st["city_label_pt"],
                                st["label_halo_mm"], roads_mm, force=force)
        if lab is None:
            return
        placer.add_symbol(pt.x, pt.y, smm, st["symbol_halo_mm"])
        lab["tier"] = row["tier"]
        chosen.append(row.name)

    # 1. capital (always) and large cities
    for i, (pt, row) in enumerate(pts):
        if row["tier"] == "capital":
            try_city(pt, row, force=True)
    for pt, row in pts:
        if row["tier"] == "large" and row.name not in chosen:
            try_city(pt, row)

    # 2. Interstates, longest first
    def route_labels(cls, size, halo, offset, min_len, kind):
        sub = highways[highways["highway_class"] == cls].sort_values("length_m", ascending=False)
        for _, r in sub.iterrows():
            lines = lines_of(to_mm(r.geometry, frame))
            placer.place_route(r["route"], lines, kind, size, halo, offset, min_len)

    route_labels("interstate", st["interstate_label_pt"], st["label_halo_mm"],
                 st["road_label_offset_mm"], t["min_interstate_label_mm"], "interstate")

    # 3. remaining cities by priority
    for pt, row in pts:
        if row.name not in chosen:
            try_city(pt, row)

    # 4. major state routes
    route_labels("major_state_route", st["state_route_label_pt"],
                 st["state_route_label_halo_mm"], st["state_route_label_offset_mm"],
                 t["min_state_route_label_mm"], "state_route")

    return placer.labels, chosen
