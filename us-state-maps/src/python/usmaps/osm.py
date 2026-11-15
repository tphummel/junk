"""Read an OSM extract into GeoDataFrames (EPSG:4326) with pyosmium."""

import geopandas as gpd
import osmium
import shapely.wkb

ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary"}
WATERWAYS = {"river", "canal"}


def _park_kind(tags):
    if tags.get("boundary") in ("protected_area", "national_park"):
        return tags.get("boundary")
    if tags.get("leisure") in ("nature_reserve", "park"):
        return tags.get("leisure")
    return None


def _water_kind(tags):
    if tags.get("natural") in ("water", "bay"):
        return tags.get("natural")
    return None


def _int(v):
    try:
        return int(str(v).replace(",", "").split(";")[0].split(".")[0])
    except (TypeError, ValueError):
        return None


def read_osm(path):
    wkb = osmium.geom.WKBFactory()
    roads, waterways, water, parks, places = [], [], [], [], []
    fp = (osmium.FileProcessor(str(path))
          .with_locations()
          .with_areas()
          .with_filter(osmium.filter.KeyFilter(
              "highway", "waterway", "natural", "boundary", "leisure", "place")))
    for o in fp:
        tags = o.tags
        try:
            if o.is_node():
                if tags.get("place") in ("city", "town", "village") and "name" in tags:
                    places.append({
                        "osm_id": o.id, "name": tags["name"], "place": tags["place"],
                        "population": _int(tags.get("population")),
                        "capital": tags.get("capital"),
                        "geometry": shapely.Point(o.location.lon, o.location.lat)})
            elif o.is_way():
                hw, ww = tags.get("highway"), tags.get("waterway")
                if hw in ROAD_CLASSES:
                    roads.append({
                        "osm_id": o.id, "highway": hw, "ref": tags.get("ref"),
                        "name": tags.get("name"),
                        "geometry": shapely.wkb.loads(wkb.create_linestring(o), hex=True)})
                elif ww in WATERWAYS:
                    waterways.append({
                        "osm_id": o.id, "waterway": ww, "name": tags.get("name"),
                        "geometry": shapely.wkb.loads(wkb.create_linestring(o), hex=True)})
            elif o.is_area():
                wk, pk = _water_kind(tags), _park_kind(tags)
                if wk or pk:
                    row = {"osm_id": o.orig_id(), "name": tags.get("name"),
                           "kind": wk or pk,
                           "geometry": shapely.wkb.loads(wkb.create_multipolygon(o), hex=True)}
                    (water if wk else parks).append(row)
        except (osmium.InvalidLocationError, RuntimeError):
            continue  # incomplete geometry at extract edges

    def gdf(rows, cols):
        return gpd.GeoDataFrame(rows or {c: [] for c in cols}, columns=cols,
                                geometry="geometry", crs="EPSG:4326")

    return {
        "roads": gdf(roads, ["osm_id", "highway", "ref", "name", "geometry"]),
        "waterways": gdf(waterways, ["osm_id", "waterway", "name", "geometry"]),
        "water": gdf(water, ["osm_id", "name", "kind", "geometry"]),
        "parks": gdf(parks, ["osm_id", "name", "kind", "geometry"]),
        "places": gdf(places, ["osm_id", "name", "place", "population", "capital", "geometry"]),
    }


def osm_timestamp(path):
    """Replication timestamp from the PBF header, if present."""
    try:
        r = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
        ts = r.header().get("osmosis_replication_timestamp")
        r.close()
        return ts or None
    except Exception:
        return None
