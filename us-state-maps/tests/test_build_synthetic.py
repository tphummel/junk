"""End-to-end build on a small synthetic 'state' (no network)."""

import json
import shutil
from pathlib import Path

import geopandas as gpd
import shapely

from usmaps.build import build_state
from usmaps.config import CONFIG_DIR

ZZ = """
enabled = false
state = "ZZ"
state_name = "Testland"
fips = "99"
geofabrik = "none"
orientation = "portrait"
map_trim_cm = [12.0, 18.0]
scale_band = [850000, 950000]
crs = "EPSG:26957"
projection = "NAD83 / Delaware (StatePlane, metres)"
capital = "Capitol"
state_route_prefixes = ["DE"]

[thresholds]
min_road_length_m = 1000
min_major_state_route_m = 5000
max_city_labels = 12
water_min_area_km2 = 1.0
river_min_length_km = 8.0
park_min_area_km2 = 5.0
min_interstate_label_mm = 11.0
min_state_route_label_mm = 11.0
large_city_pop = 30000
medium_city_pop = 10000

[letter_layout]
map_x_cm = 4.80
map_y_cm = 0.80
legend_x_cm = 5.80
legend_y_cm = 20.60
legend_width_cm = 10.00
legend_height_cm = 3.20

[acceptance]
cities = ["Capitol", "Bigtown"]
interstates = ["I-95"]
"""

W, E, S, N = -75.75, -75.15, 38.5, 39.8
CITIES = [  # name, lon, lat, pop
    ("Capitol", -75.52, 39.16, 39000), ("Bigtown", -75.55, 39.74, 70000),
    ("Midway", -75.45, 39.45, 23000), ("Southend", -75.6, 38.65, 8000),
    ("Tinyville", -75.53, 39.17, 1500),  # too close to Capitol
]


def _osm(path):
    nodes, ways = [], []
    nid = [0]

    def node(lon, lat, tags=None):
        nid[0] += 1
        t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in (tags or {}).items())
        nodes.append(f'<node id="{nid[0]}" lat="{lat}" lon="{lon}" version="1">{t}</node>')
        return nid[0]

    def way(i, coords, tags):
        refs = "".join(f'<nd ref="{node(*c)}"/>' for c in coords)
        t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        ways.append(f'<way id="{i}" version="1">{refs}{t}</way>')

    way(1, [(-75.55, 38.52), (-75.52, 39.0), (-75.56, 39.5), (-75.55, 39.78)],
        {"highway": "motorway", "ref": "I 95"})
    way(2, [(-75.35, 38.55), (-75.40, 39.1), (-75.45, 39.44)], {"highway": "primary", "ref": "US 13;DE 1"})
    way(3, [(-75.7, 39.2), (-75.6, 39.21), (-75.52, 39.16)], {"highway": "tertiary", "ref": "DE 8"})
    way(4, [(-75.7, 38.7), (-75.69, 38.705)], {"highway": "tertiary", "ref": "DE 99"})
    way(5, [(-75.3, 39.0), (-75.2, 39.5)], {"highway": "primary", "ref": "US 113"})
    way(6, [(-75.7, 39.5), (-75.5, 39.52), (-75.3, 39.55)], {"waterway": "canal", "name": "Big Canal"})
    lake = [(-75.68, 38.9), (-75.62, 38.9), (-75.62, 38.95), (-75.68, 38.95), (-75.68, 38.9)]
    way(7, lake, {"natural": "water", "name": "Lake"})
    park = [(-75.45, 38.7), (-75.35, 38.7), (-75.35, 38.8), (-75.45, 38.8), (-75.45, 38.7)]
    way(8, park, {"leisure": "nature_reserve"})
    for name, lon, lat, pop in CITIES:
        node(lon, lat, {"place": "town", "name": name, "population": pop})
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6">\n'
                    + "\n".join(nodes + ways) + "\n</osm>\n")


def _tiger(tmp):
    land = shapely.box(W, S, E, N)
    legal = shapely.box(W, S, E + 0.08, N)  # includes a strip of "state waters"
    gpd.GeoDataFrame({"STATEFP": ["99"]}, geometry=[land], crs="EPSG:4326").to_file(tmp / "cb.gpkg")
    gpd.GeoDataFrame({"STATEFP": ["99"]}, geometry=[legal], crs="EPSG:4326").to_file(tmp / "legal.gpkg")
    rows = [{"PLACEFP": f"{i:05d}", "NAME": n, "LSAD": "25", "INTPTLAT": f"{lat:+.6f}",
             "INTPTLON": f"{lon:+.6f}", "geometry": shapely.Point(lon, lat).buffer(0.01)}
            for i, (n, lon, lat, _) in enumerate(CITIES)]
    gpd.GeoDataFrame(rows, crs="EPSG:4326").to_file(tmp / "places.gpkg")
    pop = {f"{i:05d}": p for i, (_, _, _, p) in enumerate(CITIES)}
    return {"cb": tmp / "cb.gpkg", "legal": tmp / "legal.gpkg", "places": tmp / "places.gpkg"}, pop


def test_synthetic_build(tmp_path: Path):
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir()
    shutil.copy(CONFIG_DIR / "defaults.toml", cfg_dir)
    (cfg_dir / "ZZ.toml").write_text(ZZ)
    tiger, pop = _tiger(tmp_path)
    _osm(tmp_path / "zz.osm")

    manifest, checks = build_state(
        "ZZ", inputs={"tiger": tiger, "population": pop, "osm": tmp_path / "zz.osm"},
        maps_dir=tmp_path / "maps", previews_dir=tmp_path / "previews", config_dir=cfg_dir)

    out = tmp_path / "maps" / "ZZ"
    for f in ("us_ZZ_map_12x18_bw.pdf", "us_ZZ_letter_with_legend.pdf", "ZZ.gpkg",
              "ZZ_manifest.json", "ZZ_qa_report.md"):
        assert (out / f).stat().st_size > 0, f
    assert (tmp_path / "previews" / "ZZ" / "ZZ_map_400pct.png").exists()

    c = manifest["content"]
    assert c["interstates"] == ["I-95"]
    assert c["major_state_routes"] == ["DE-1"]
    assert "DE-99" not in c["major_state_routes"]
    assert not any(r.startswith("US-") for r in c["interstates"] + c["major_state_routes"])
    assert "Capitol" in c["city_labels"] and "Tinyville" not in c["city_labels"]
    assert c["rivers"] == ["Big Canal"]
    assert c["park_areas"] == 1
    assert json.loads((out / "ZZ_manifest.json").read_text())["approx_scale"] == manifest["approx_scale"]
    fails = [ch for ch in checks if ch["status"] == "fail"]
    assert not fails, fails
