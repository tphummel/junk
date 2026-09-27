"""Build pipeline for one state: inputs -> layers -> labels -> PDFs, GeoPackage,
manifest, QA report and previews."""

import datetime as dt
import json
import subprocess
import warnings

import geopandas as gpd
import matplotlib.pyplot as plt
import shapely

from . import fetch, osm, process, qa
from .config import LETTER_CM, ROOT, load_state
from .georef import georeference
from .labels import place_labels

PREVIEW_DPI = {"100": 150, "200": 300, "400": 600}


def fetch_inputs(cfg):
    return {"tiger": fetch.fetch_tiger(cfg), "population": fetch.fetch_population(cfg),
            "osm": fetch.fetch_osm(cfg)}


def _git_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def build_layers(cfg, inputs):
    crs = cfg["crs"]
    outline, legal = process.load_boundaries(cfg, inputs["tiger"], crs)
    frame = process.compute_frame(cfg, outline)
    print(f"  scale 1:{frame['scale']:,}")
    raw = osm.read_osm(inputs["osm"])
    print("  osm: " + ", ".join(f"{k}={len(v)}" for k, v in raw.items()))
    places = process.build_places(inputs["tiger"]["places"], inputs["population"],
                                  raw["places"], cfg, frame, outline, crs)
    anchors = process.anchor_cities(places, frame)
    roads = raw["roads"][raw["roads"]["ref"].notna()].to_crs(crs)
    highways = process.select_highways(roads, cfg, frame, legal, anchors)
    places = process.rank_places(places, highways, frame)
    water, rivers = process.build_water(raw["water"], raw["waterways"], outline, legal, frame, crs)
    parks = process.build_parks(raw["parks"], outline, frame, crs)
    layers = {"outline": outline, "legal": legal, "highways": highways, "places": places,
              "water": water, "rivers": rivers, "parks": parks}
    return frame, layers


def write_geopackage(path, cfg, layers):
    crs = cfg["crs"]
    if path.exists():
        path.unlink()
    hw = layers["highways"]
    drawn = hw[hw["highway_class"].isin(["interstate", "major_state_route"])]
    out = {
        "boundary": gpd.GeoDataFrame({"state": [cfg["state"]]}, geometry=[layers["outline"]], crs=crs),
        "water": layers["water"],
        "waterways": layers["rivers"],
        "parks": layers["parks"],
        "highways": drawn,
        "places": layers["places"].rename(columns={"priority": "label_priority"}),
    }
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for name, gdf in out.items():
            if len(gdf):
                gdf.to_file(path, layer=name, driver="GPKG")


def manifest_for(cfg, frame, layers, labels, scale_err, inputs, files):
    st = cfg["state"]
    lay = cfg["letter_layout"]
    t = frame["thresholds"]
    hw = layers["highways"]
    w, h = cfg["map_trim_cm"]
    m = {
        "state": st,
        "state_name": cfg["state_name"],
        "orientation": cfg["orientation"],
        "map_trim_cm": [w, h],
        "approx_scale": frame["scale"],
        "projection": cfg["projection"],
        "padding_percent": cfg["padding_percent"],
        "features": {"boundary": True, "interstates": True, "major_state_routes": True,
                     "us_highways": False, "minor_state_routes": False, "cities": True,
                     "counties": False, "water": True, "parks": True},
        "thresholds": {k: t[k] for k in (
            "min_road_length_m", "min_major_state_route_m", "simplification_m",
            "label_spacing_m", "max_city_labels", "water_min_area_km2",
            "river_min_length_km", "park_min_area_km2")},
        "letter_layout": {"page_cm": list(LETTER_CM), "map_x_cm": lay["map_x_cm"],
                          "map_y_cm": lay["map_y_cm"], "map_width_cm": w, "map_height_cm": h,
                          "legend_x_cm": lay["legend_x_cm"], "legend_y_cm": lay["legend_y_cm"],
                          "legend_width_cm": lay["legend_width_cm"],
                          "legend_height_cm": lay["legend_height_cm"]},
        "data_sources": {"boundary": f"TIGER/Line {cfg['sources']['tiger_year']} (legal) + "
                                     f"Cartographic Boundary {cfg['sources']['cb_year']} 1:500k (outline)",
                         "highways": "OpenStreetMap",
                         "places": f"TIGER/Line {cfg['sources']['tiger_year']} Places + Census population (2023 est. / 2020 PL) "
                                   "population + OSM supplement",
                         "water": "OpenStreetMap + TIGER state waters", "parks": "OpenStreetMap"},
        "outputs": {k: v.name for k, v in files.items()},
        "scale_error": scale_err,
        "content": {
            "interstates": sorted(hw.loc[hw["highway_class"] == "interstate", "route"]),
            "major_state_routes": sorted(hw.loc[hw["highway_class"] == "major_state_route", "route"]),
            "dropped_minor_state_routes": sorted(hw.loc[hw["highway_class"] == "minor_state_route", "route"]),
            "city_labels": [l["text"] for l in labels if l["kind"] == "city"],
            "route_labels": [l["text"] for l in labels if l["kind"] != "city"],
            "rivers": sorted(layers["rivers"]["name"]),
            "water_areas": len(layers["water"]),
            "park_areas": len(layers["parks"]),
        },
        "build": {"git_sha": _git_sha(),
                  "built_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                  "osm_file": inputs["osm"].name if hasattr(inputs["osm"], "name") else str(inputs["osm"]),
                  "osm_timestamp": osm.osm_timestamp(inputs["osm"])},
    }
    if cfg["crs"].startswith("+proj"):
        m["projection_string"] = cfg["crs"]
    else:
        m["crs"] = cfg["crs"]
    return m


def build_state(code, inputs=None, maps_dir=None, previews_dir=None, config_dir=None):
    cfg = load_state(code, config_dir) if config_dir else load_state(code)
    st = cfg["state"]
    print(f"== {st}: {cfg['state_name']}")
    maps_dir = (maps_dir or ROOT / "maps") / st
    previews_dir = (previews_dir or ROOT / "output" / "qa_previews") / st
    maps_dir.mkdir(parents=True, exist_ok=True)
    previews_dir.mkdir(parents=True, exist_ok=True)
    inputs = inputs or fetch_inputs(cfg)

    frame, layers = build_layers(cfg, inputs)
    labels, chosen = place_labels(cfg, frame, layers["places"], layers["highways"])
    layers["places"]["labelled"] = layers["places"].index.isin(chosen)
    print(f"  labels: {len(labels)} ({sum(l['kind'] == 'city' for l in labels)} cities)")

    from . import render  # imported late: sets matplotlib backend/rcParams

    w, h = cfg["map_trim_cm"]
    dims = f"{int(w)}x{int(h)}"
    files = {
        "map_pdf": maps_dir / f"us_{st}_map_{dims}_bw.pdf",
        "letter_pdf": maps_dir / f"us_{st}_letter_with_legend.pdf",
        "geopackage": maps_dir / f"{st}.gpkg",
        "manifest": maps_dir / f"{st}_manifest.json",
        "qa_report": maps_dir / f"{st}_qa_report.md",
    }
    meta = {"Creator": "us-state-maps", "Title": None}

    fig = render.map_figure(cfg, frame, layers, labels)
    fig.savefig(files["map_pdf"], metadata=meta)
    for zoom, dpi in PREVIEW_DPI.items():
        fig.savefig(previews_dir / f"{st}_map_{zoom}pct.png", dpi=dpi)
    plt.close(fig)
    georeference(files["map_pdf"], (0, 0, w / 2.54 * 72, h / 2.54 * 72), frame["extent"], cfg["crs"])

    fig, map_cm = render.letter_figure(cfg, frame, layers, labels)
    fig.savefig(files["letter_pdf"], metadata=meta)
    fig.savefig(previews_dir / f"{st}_letter_100pct.png", dpi=150)
    plt.close(fig)
    x0 = map_cm[0] / 2.54 * 72
    y0 = (LETTER_CM[1] - map_cm[1] - h) / 2.54 * 72
    georeference(files["letter_pdf"], (x0, y0, x0 + w / 2.54 * 72, y0 + h / 2.54 * 72),
                 frame["extent"], cfg["crs"])

    write_geopackage(files["geopackage"], cfg, layers)
    scale_err = qa.scale_error(layers["outline"], cfg["crs"])
    manifest = manifest_for(cfg, frame, layers, labels, scale_err, inputs, files)
    checks = qa.run_checks(cfg, frame, layers, labels, files, scale_err)
    manifest["qa"] = {s: sum(c["status"] == s for c in checks) for s in ("pass", "warn", "fail")}
    files["manifest"].write_text(json.dumps(manifest, indent=2) + "\n")
    qa.write_report(files["qa_report"], cfg, manifest, checks)
    for c in checks:
        if c["status"] != "pass":
            print(f"  {c['status'].upper()}: {c['section']}: {c['check']} {c['detail']}")
    print(f"  qa: {manifest['qa']}")
    return manifest, checks
