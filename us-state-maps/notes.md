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
