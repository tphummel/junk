"""Download and cache raw inputs under data/raw/. Files already present are
reused, so CI can restore data/raw from a cache."""

import json
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from .config import ROOT

RAW = ROOT / "data" / "raw"
USER_AGENT = "us-state-maps (github.com/tphummel/junk)"


def _download(url, dest, attempts=4):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
            tmp.rename(dest)
            return dest
        except OSError as e:
            if i == attempts - 1:
                raise RuntimeError(f"download failed: {url}: {e}") from e
            time.sleep(2 ** (i + 1))


def tiger_paths(cfg):
    src = cfg["sources"]
    ty, cy, fips = src["tiger_year"], src["cb_year"], cfg["fips"]
    base = "https://www2.census.gov/geo/tiger"
    return {
        "legal": (f"{base}/TIGER{ty}/STATE/tl_{ty}_us_state.zip",
                  RAW / "tiger" / f"tl_{ty}_us_state.zip"),
        "cb": (f"{base}/GENZ{cy}/shp/cb_{cy}_us_state_500k.zip",
               RAW / "tiger" / f"cb_{cy}_us_state_500k.zip"),
        "places": (f"{base}/TIGER{ty}/PLACE/tl_{ty}_{fips}_place.zip",
                   RAW / "tiger" / f"tl_{ty}_{fips}_place.zip"),
    }


def fetch_tiger(cfg):
    return {k: _download(url, dest) for k, (url, dest) in tiger_paths(cfg).items()}


def fetch_population(cfg):
    """2020 decennial PL counts per place, as {PLACEFP: population}."""
    fips = cfg["fips"]
    dest = RAW / "census" / f"pl2020_place_{fips}.json"
    url = f"{cfg['sources']['census_pl']}?get=NAME,P1_001N&for=place:*&in=state:{fips}"
    try:
        _download(url, dest)
    except RuntimeError as e:
        print(f"warning: census population unavailable, using OSM only ({e})")
        return {}
    rows = json.loads(dest.read_text())
    head = rows[0]
    i_pop, i_place = head.index("P1_001N"), head.index("place")
    return {r[i_place]: int(r[i_pop]) for r in rows[1:]}


OSMIUM_FILTER = [
    "w/highway=motorway,trunk,primary,secondary,tertiary",
    "w/waterway=river,canal",
    "wr/natural=water,bay",
    "wr/boundary=protected_area,national_park",
    "wr/leisure=nature_reserve,park",
    "n/place=city,town,village",
]


def fetch_osm(cfg):
    """Geofabrik extract, pre-filtered with osmium-tool when available."""
    name = cfg["geofabrik"].rsplit("/", 1)[-1]
    url = f"{cfg['sources']['geofabrik_base']}/{cfg['geofabrik']}-latest.osm.pbf"
    pbf = _download(url, RAW / "osm" / f"{name}-latest.osm.pbf")
    if shutil.which("osmium") is None:
        return pbf
    out = pbf.with_name(f"{name}-filtered.osm.pbf")
    if not out.exists() or out.stat().st_mtime < pbf.stat().st_mtime:
        subprocess.run(["osmium", "tags-filter", str(pbf), *OSMIUM_FILTER,
                        "-o", str(out), "--overwrite"], check=True)
    return out
