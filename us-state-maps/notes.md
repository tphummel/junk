# notes

- Started from the locked plan (18 x 12 cm trim, legend outside trim on Letter, DE + PA pilots).
- Sandbox could not reach download.geofabrik.de or www2.census.gov (proxy 403), so the
  pipeline is developed against a synthetic state fixture (tests/test_build_synthetic.py)
  and real builds run in GitHub Actions.
- Chose matplotlib over headless QGIS for rendering: pip-only deps, deterministic,
  testable; fonts embedded as TrueType (pdf.fonttype 42) so text stays text.
- pyosmium 4 FileProcessor: `.with_locations().with_areas().with_filter(KeyFilter(...))`
  resolves node locations for untagged nodes even though the filter hides them from Python.
  Closed ways yield both a Way and an Area; only Areas are used for water/parks.
- shapely.ops.linemerge rejects a bare LineString; pass a list of lines.
- numpy bools are not `True` -> QA status must use truthiness, not `is True`.
- "Connects two cities" initially counted a suburb next to the capital as a second city;
  fixed by thinning anchor cities to the minimum label spacing first.
- GeoPDF: /VP viewport with /Measure /GEO, GPTS as lat/lon in the CRS datum and GCS as
  WKT1_GDAL PROJCS. Verified with gdalinfo: map-only PDF extent is exactly trim x scale.
- Scale error: DE State Plane (EPSG:26957) max |k-1| ~ 0.0007 %; PA custom LCC ~ 0.02 %.
- The plan's PA PROJ string contains `+to_wgs84=0` (invalid); dropped.
- Label orientation: near-vertical route labels normalised to read bottom-to-top.
- CI run 1: api.census.gov returned an empty body from the Actions runner. Switched to the static
  Vintage 2023 estimates CSV on www2.census.gov (incorporated places), API optional, OSM fallback.
- CI run 3 (first real build, both states pass automated QA): DE 1:930,000, PA 1:2,970,000.
  But selection is far too permissive on real OSM: DE 27 / PA 110 "major" state routes,
  PA ~250 named creeks (same-name creeks were summed statewide), PA 169 parks.
  Fix: per-connected-stretch river length, and ranked caps (routes by
  length x (0.5 + major_fraction) x (1 + cities), rivers by length, parks by area).
- The artifact blob host and job-log redirect are blocked from the sandbox, so review
  here relies on the content summary printed in the build log.
