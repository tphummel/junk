# us-state-maps

Grayscale, print-ready reference maps of US states. Each map fits an
**18 × 12 cm trim**, and each state also gets a **US Letter proof sheet** with
the legend placed outside that trim. The pilots are **Delaware** (portrait,
12 × 18 cm) and **Pennsylvania** (landscape, 18 × 12 cm). Per the build order,
no other states get built until both pilots are reviewed and their style is
locked.

## Outputs (per state)

| File | What |
|---|---|
| `maps/ST/us_ST_map_WxH_bw.pdf` | Map only, exactly the trim size, vector, grayscale, georeferenced (GeoPDF) |
| `maps/ST/us_ST_letter_with_legend.pdf` | Letter sheet: map + crop marks + legend below the trim (map viewport georeferenced) |
| `maps/ST/ST.gpkg` | Processed layers: `boundary`, `water`, `waterways`, `parks`, `highways`, `places` |
| `maps/ST/ST_manifest.json` | The plan's manifest schema, plus scale error, selected content and build/data provenance |
| `maps/ST/ST_qa_report.md` | Automated QA checklist results + the manual review items |
| `output/qa_previews/ST/*.png` | 100 / 200 / 400 % previews (150 / 300 / 600 dpi) and a Letter preview |

## Releases

`.github/workflows/us-state-maps.yml` runs on every push and PR that touches
`us-state-maps/`. It runs the tests, downloads the source data (cached weekly),
builds every state with `enabled = true` and uploads
`us-state-maps-YYYY.MM.DD-<sha>.zip` as a workflow artifact. On a push to
`main` it also publishes a GitHub release with the same tag, zip and
`SHA256SUMS`. Releases are not marked "latest", so they don't displace other
projects' releases in this repo. Each job's summary includes the QA reports.

## Running locally

```bash
cd us-state-maps
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt        # optional: apt install osmium-tool (pre-filter)
python -m pytest -q tests              # unit + synthetic end-to-end build, no network
PYTHONPATH=src/python python -m usmaps build DE      # or PA, or --all
```

Raw data lands in `data/raw/` (TIGER/Line + cartographic boundary, Census
place populations (Vintage 2023 estimates CSV, plus the 2020 PL API when it answers), Geofabrik OSM extracts). All outputs are git-ignored.

## Pipeline

`src/python/usmaps/`:

| Module | Plan steps |
|---|---|
| `fetch.py` | 1–2: download TIGER, Census population, Geofabrik PBF; `osmium tags-filter` pre-filter |
| `osm.py` | read filtered PBF with pyosmium (roads, waterways, water/park multipolygons, place nodes) |
| `process.py` | 3–13: reproject, clip, classify highways, drop minor/US routes, merge by route, simplify, rank places, filter water & parks |
| `labels.py` | 15: priority placement with collision removal |
| `render.py` | 16–17: map-only PDF and Letter sheet with legend |
| `georef.py` | GeoPDF viewport (GDAL/QGIS read the map's CRS and extent) |
| `qa.py` | 18: automated checks, scale-error test, QA report |
| `build.py` | orchestration, GeoPackage, manifest |

Configuration lives in `config/defaults.toml` (series style, limits) and
`config/ST.toml` (per state: trim, CRS, thresholds, Letter layout, manual
route include/exclude list, acceptance targets).

### Rules as implemented

- **Scale**: the smallest denominator (rounded up to 10,000) that fits the
  state's outline in the trim with 7 % total padding. The state is centred in
  the frame. QA warns when the scale falls outside the configured target band.
- **Thresholds** come from the plan. When a state config doesn't override
  them, they're derived from the scale: `min_road = 0.001·S`,
  `simplification = clamp(0.0002·S, 50, 2000)`, `label_spacing = 0.02·S`.
- **Highways**: route refs are parsed from OSM `ref` (`I 95;US 13`, `DE 1`,
  …). A way on an Interstate is drawn as the Interstate. US-only ways are
  dropped. Suffixed variants (Bus/Truck/Alt) are dropped. Ways are merged per
  route. A state route is *major* if it's on the include list, or if it is at
  least `min_major_state_route_m` long **and** either ≥ 50 % of it is
  motorway/trunk/primary or it passes within 3 mm (paper) of ≥ 2 anchor
  cities. Eligible routes are then ranked by
  `length_km × (0.5 + major_fraction) × (1 + min(cities, 3))` and only the top
  `max_major_state_routes` per state are kept; manual includes always stay.
  `*_link` ramps are never loaded.
- **Cities**: TIGER places with Census population (OSM `population` as fallback), located at the OSM
  place node when one matches. Tiers are capital / large / medium / small.
  Interstate-corridor and state-route-junction cities get priority bonuses.
  Labels are placed in this order: capital, large cities, Interstate labels,
  the remaining cities, then state-route labels. Each city label tries 8
  positions and prefers the one covering the least road. A city whose label
  can't be placed is dropped along with its symbol. The per-state maximum
  label count and a minimum spacing are enforced.
- **Route labels** sit above the longest straight run that is at least the
  configured minimum length. Near-vertical labels read bottom-to-top. When a
  route curves too much for that, a horizontal "standing" label is placed
  near it. If a label collides, it's dropped.
- **Water**: OSM `natural=water|bay` polygons plus TIGER *state waters*
  (legal boundary minus shoreline outline: bays, Lake Erie, border rivers),
  clipped to the legal area, dissolved and area-filtered. Named rivers and
  canals are merged by name, and each connected stretch is length-filtered on
  its own. The top `max_rivers` stretches are kept, with named rivers and canals
  ranked ahead of creeks and then by length; stretches already drawn as
  water area are removed. Shorelines are outlined, but artificial cut edges
  at the legal boundary aren't.
- **Parks**: OSM protected areas, nature reserves and parks, dissolved,
  area-filtered, capped to the largest `max_parks`, and left unlabelled.

### Deviations from the plan (so far)

- **Rendering is Python/matplotlib, not QGIS.** It needs no GUI, runs quickly
  in CI and the whole pipeline is unit-testable. Output is still vector PDF
  with embedded fonts. There is no `ST.qgs` yet. To edit a map by hand, open
  the GeoPackage (or the GeoPDF) in QGIS. A generated `.qgs` would be a
  natural follow-up.
- **Outline is the Cartographic Boundary 1:500k file.** The TIGER/Line state
  polygon includes state waters (Delaware Bay, Lake Erie), so it's used for
  clipping and to derive the water fill rather than as the drawn outline.
- The PA PROJ string drops `+to_wgs84=0`, which isn't valid PROJ syntax
  (`+datum=NAD83` already covers it). The measured max scale error over PA is
  about 0.02 %.
- **Caps on top of the plan's thresholds.** On real OSM data, the plan's
  rules alone let through 110 PA and 27 DE "major" state routes and about 250
  named PA creeks, because OSM tags many PA routes `primary` and lots of
  creeks `waterway=river`. Ranked caps (DE 10 routes / 15 rivers / 15 parks;
  PA 20 / 20 / 50) keep the maps legible. They are the main tuning knobs for
  pilot review.
- Wetlands/marshes aren't drawn yet. The plan's candidate lists (e.g. DE-13,
  DE-301) include US routes, which the "no US routes" rule drops.
