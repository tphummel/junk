"""Turn raw TIGER + OSM inputs into the five map layers, in the state CRS."""

import re

import geopandas as gpd
import pandas as pd
import shapely
from shapely.ops import linemerge

from .config import derive_thresholds, fit_scale

REF_RE = re.compile(r"^\s*(I|US|[A-Z]{2})[\s-]*(\d+[A-Z]?)\s*(\S.*)?$")
MAJOR_HIGHWAYS = {"motorway", "trunk", "primary"}
PRIORITY = {"capital": 1000, "large": 900, "medium": 800, "small": 700}


# --- boundary & frame -------------------------------------------------------

def load_boundaries(cfg, tiger, crs):
    """(outline, legal): the shoreline-clipped cartographic outline used for
    drawing, and the TIGER/Line legal area (incl. state waters) used for
    clipping so border rivers and bays are not cut at the shore."""
    fips = cfg["fips"]
    cb = gpd.read_file(tiger["cb"])
    legal = gpd.read_file(tiger["legal"])
    cb = cb[cb["STATEFP"] == fips].to_crs(crs)
    legal = legal[legal["STATEFP"] == fips].to_crs(crs)
    if cb.empty or legal.empty:
        raise ValueError(f"state FIPS {fips} not found in TIGER boundary files")
    outline = shapely.make_valid(cb.geometry.union_all())
    legal_geom = shapely.make_valid(legal.geometry.union_all()).union(outline)
    return outline, legal_geom


def compute_frame(cfg, outline):
    """Scale denominator and projected extent of the trim, centred on the state."""
    trim_cm = cfg["map_trim_cm"]
    scale = fit_scale(outline.bounds, trim_cm, cfg["padding_percent"], cfg["scale_round"])
    minx, miny, maxx, maxy = outline.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    w = trim_cm[0] / 100.0 * scale
    h = trim_cm[1] / 100.0 * scale
    return {
        "scale": scale,
        "extent": (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2),
        "trim_mm": (trim_cm[0] * 10, trim_cm[1] * 10),
        "thresholds": derive_thresholds(cfg, scale),
    }


# --- highways ---------------------------------------------------------------

def parse_refs(ref):
    """'I 95;US 13;DE 1' -> [('I','95'), ('US','13'), ('DE','1')]. Suffixed
    variants (Bus, Truck, Alt, ...) are skipped: they are not the main route."""
    out = []
    for part in (ref or "").split(";"):
        m = REF_RE.match(part)
        if m and not m.group(3):
            out.append((m.group(1), m.group(2)))
    return out


def classify_way(ref, highway, prefixes):
    """(highway_class, route) for one OSM way. Concurrent routes take the
    Interstate; US routes are never shown."""
    refs = parse_refs(ref)
    for net, num in refs:
        if net == "I":
            return "interstate", f"I-{num}"
    for net, num in refs:
        if net in prefixes:
            return "state_route", f"{net}-{num}"
    return "other", None


def _lines(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if hasattr(geom, "geoms"):
        return [g for sub in geom.geoms for g in _lines(sub)]
    return []


def _merge(geoms):
    lines = [l for g in geoms for l in _lines(g)]
    if not lines:
        return shapely.MultiLineString()
    merged = linemerge(_lines(shapely.unary_union(lines)))
    return shapely.MultiLineString(_lines(merged))


def select_highways(roads, cfg, frame, legal, city_points):
    """Merged routes with highway_class in {interstate, major_state_route,
    minor_state_route}. `city_points` are candidate city locations used for
    the 'connects two cities' rule."""
    t = frame["thresholds"]
    s = frame["scale"]
    prefixes = set(cfg["state_route_prefixes"])
    include = set(cfg["routes"]["include"])
    exclude = set(cfg["routes"]["exclude"])

    cls = roads.apply(lambda r: classify_way(r["ref"], r["highway"], prefixes), axis=1)
    roads = roads.assign(highway_class=[c[0] for c in cls], route=[c[1] for c in cls])
    roads = roads[roads["highway_class"] != "other"]
    roads = roads.assign(geometry=roads.geometry.intersection(legal))
    roads = roads[~roads.geometry.is_empty]
    roads = roads.assign(length_m=roads.geometry.length)

    connect_m = t["city_connect_mm"] / 1000.0 * s
    rows = []
    for (hc, route), grp in roads.groupby(["highway_class", "route"]):
        total = grp["length_m"].sum()
        major = grp.loc[grp["highway"].isin(MAJOR_HIGHWAYS), "length_m"].sum()
        geom = _merge(grp.geometry)
        connects = sum(1 for p in city_points if geom.distance(p) <= connect_m)
        if hc == "state_route":
            is_major = (route in include) or (
                total >= t["min_major_state_route_m"]
                and (major / total >= t["major_class_fraction"] or connects >= 2))
            if route in exclude:
                is_major = False
            hc = "major_state_route" if is_major else "minor_state_route"
        parts = [l for l in _lines(geom) if l.length >= t["min_road_length_m"]]
        if not parts:
            continue
        geom = shapely.MultiLineString(parts).simplify(t["simplification_m"])
        rows.append({"route": route, "highway_class": hc, "length_m": round(total),
                     "major_fraction": round(major / total, 3) if total else 0.0,
                     "connects_cities": connects, "geometry": geom})
    cols = ["route", "highway_class", "length_m", "major_fraction", "connects_cities", "geometry"]
    return gpd.GeoDataFrame(rows or {c: [] for c in cols}, columns=cols,
                            geometry="geometry", crs=roads.crs)


# --- water & parks ----------------------------------------------------------

def _polys(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in _polys(g)]
    return []


def _area_filter(geoms, clip, min_area_m2, simplify_m):
    """Clip, dissolve, explode and keep polygons >= min_area_m2."""
    geoms = [g for g in geoms if g is not None and not g.is_empty
             and g.area >= 0.01 * min_area_m2]
    if not geoms:
        return []
    merged = shapely.make_valid(shapely.unary_union(geoms)).intersection(clip)
    keep = [p for p in _polys(merged) if p.area >= min_area_m2]
    return [p.simplify(simplify_m / 2, preserve_topology=True) for p in keep]


def build_water(osm_water, osm_waterways, outline, legal, frame, crs):
    t = frame["thresholds"]
    min_area = t["water_min_area_km2"] * 1e6
    polys = list(osm_water.to_crs(crs).geometry)
    # State waters (bays, lake, border rivers) present in the legal TIGER
    # area but not in the shoreline outline.
    polys += _polys(legal.difference(outline))
    water = _area_filter(polys, legal, min_area, t["simplification_m"])
    water_union = shapely.unary_union(water) if water else shapely.Polygon()

    ww = osm_waterways.to_crs(crs)
    ww = ww[ww["name"].notna()]
    rivers = []
    for name, grp in ww.groupby("name"):
        geom = _merge(grp.geometry).intersection(legal)
        if geom.length < t["river_min_length_km"] * 1000:
            continue
        geom = geom.difference(water_union)  # drawn as area already
        geom = shapely.MultiLineString(_lines(geom)).simplify(t["simplification_m"])
        if not geom.is_empty:
            rivers.append({"name": name, "kind": grp["waterway"].mode().iat[0],
                           "length_m": round(grp.geometry.length.sum()), "geometry": geom})
    water_gdf = gpd.GeoDataFrame({"area_km2": [round(p.area / 1e6, 2) for p in water]},
                                 geometry=water, crs=crs)
    cols = ["name", "kind", "length_m", "geometry"]
    rivers_gdf = gpd.GeoDataFrame(rivers or {c: [] for c in cols}, columns=cols,
                                  geometry="geometry", crs=crs)
    return water_gdf, rivers_gdf


def build_parks(osm_parks, outline, frame, crs):
    t = frame["thresholds"]
    polys = _area_filter(list(osm_parks.to_crs(crs).geometry), outline,
                         t["park_min_area_km2"] * 1e6, t["simplification_m"])
    return gpd.GeoDataFrame({"area_km2": [round(p.area / 1e6, 2) for p in polys]},
                            geometry=polys, crs=crs)


# --- places -----------------------------------------------------------------

def build_places(tiger_places_path, population, osm_places, cfg, frame, outline, crs):
    """All populated places with a tier and base priority. OSM place nodes
    supply the symbol location (town centre) and a population fallback."""
    t = frame["thresholds"]
    tp = gpd.read_file(tiger_places_path).to_crs(crs)
    op = osm_places.to_crs(crs)
    rows = []
    for _, r in tp.iterrows():
        pop = population.get(r["PLACEFP"])
        pt = shapely.Point(float(r["INTPTLON"]), float(r["INTPTLAT"]))
        pt = gpd.GeoSeries([pt], crs="EPSG:4326").to_crs(crs).iat[0]
        match = op[(op["name"] == r["NAME"]) & op.geometry.within(r.geometry.buffer(500))]
        if not match.empty:
            pt = match.geometry.iat[0]
            if pop is None and pd.notna(match["population"].iat[0]):
                pop = match["population"].iat[0]
        if pop is None or pd.isna(pop) or pop <= 0 or not outline.contains(pt):
            continue
        rows.append({"name": r["NAME"], "placefp": r["PLACEFP"], "lsad": r["LSAD"],
                     "population": int(pop), "geometry": pt})
    df = gpd.GeoDataFrame(rows, geometry="geometry", crs=crs)
    capital = cfg["capital"]

    def tier(row):
        if row["name"] == capital:
            return "capital"
        if row["population"] >= t["large_city_pop"]:
            return "large"
        if row["population"] >= t["medium_city_pop"]:
            return "medium"
        return "small"

    df["tier"] = df.apply(tier, axis=1)
    if not (df["tier"] == "capital").any():
        raise ValueError(f"capital {capital!r} not found in places")
    # A place name can repeat (e.g. a borough and a township CDP); keep the largest.
    df = df.sort_values("population", ascending=False).drop_duplicates("name")
    df["priority"] = df["tier"].map(PRIORITY)
    return df.reset_index(drop=True)


def anchor_cities(places, frame):
    """Likely-labelled cities for the 'connects two cities' route rule: the
    largest places, greedily thinned to the minimum label spacing so that a
    suburb next to its city does not count as a second city."""
    t = frame["thresholds"]
    min_d = t["min_city_spacing_mm"] / 1000.0 * frame["scale"]
    out = []
    for pt in places.sort_values("population", ascending=False).geometry:
        if all(pt.distance(q) >= min_d for q in out):
            out.append(pt)
        if len(out) >= t["max_city_labels"]:
            break
    return out


def rank_places(places, highways, frame):
    """Priority bonuses from the plan's ordering: interstate-corridor cities,
    then major state-route junction cities, then by population."""
    s = frame["scale"]
    near = frame["thresholds"]["city_connect_mm"] / 1000.0 * s
    inter = highways[highways["highway_class"] == "interstate"].geometry
    state = highways[highways["highway_class"] == "major_state_route"].geometry
    inter_u = shapely.unary_union(list(inter)) if len(inter) else None
    bonus = []
    for pt in places.geometry:
        b = 0
        if inter_u is not None and pt.distance(inter_u) <= near:
            b += 50
        if sum(1 for g in state if pt.distance(g) <= near) >= 2:
            b += 25
        bonus.append(b)
    places = places.assign(priority=places["priority"] + pd.Series(bonus, index=places.index))
    return places.sort_values(["priority", "population"], ascending=False).reset_index(drop=True)
