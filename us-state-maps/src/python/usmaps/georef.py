"""Make PDFs geospatial (ISO 32000-2 / Adobe GEO measure viewport), so GIS
tools such as GDAL and QGIS can read the map's coordinates."""

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, DictionaryObject, FloatObject, NameObject,
                           TextStringObject)
from pyproj import CRS, Transformer


def corners_latlon(extent, crs):
    """Trim corners LL, UL, UR, LR as (lat, lon) in the CRS's own datum."""
    crs = CRS.from_user_input(crs)
    tr = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    xmin, ymin, xmax, ymax = extent
    out = []
    for x, y in ((xmin, ymin), (xmin, ymax), (xmax, ymax), (xmax, ymin)):
        lon, lat = tr.transform(x, y)
        out.append((lat, lon))
    return out


def _nums(vals):
    return ArrayObject([FloatObject(round(v, 9)) for v in vals])


def georeference(pdf_path, bbox_pt, extent, crs, name="Map"):
    """Attach a /VP viewport over `bbox_pt` (x0, y0, x1, y1 in PDF points)."""
    crs = CRS.from_user_input(crs)
    gpts = [v for ll in corners_latlon(extent, crs) for v in ll]
    measure = DictionaryObject({
        NameObject("/Type"): NameObject("/Measure"),
        NameObject("/Subtype"): NameObject("/GEO"),
        NameObject("/Bounds"): _nums([0, 0, 0, 1, 1, 1, 1, 0]),
        NameObject("/GPTS"): _nums(gpts),
        NameObject("/LPTS"): _nums([0, 0, 0, 1, 1, 1, 1, 0]),
        NameObject("/GCS"): DictionaryObject({
            NameObject("/Type"): NameObject("/PROJCS"),
            NameObject("/WKT"): TextStringObject(crs.to_wkt("WKT1_GDAL")),
        }),
        NameObject("/PDU"): ArrayObject([NameObject("/KM"), NameObject("/SQKM"),
                                         NameObject("/DEG")]),
    })
    vp = DictionaryObject({
        NameObject("/Type"): NameObject("/Viewport"),
        NameObject("/BBox"): _nums(bbox_pt),
        NameObject("/Name"): TextStringObject(name),
        NameObject("/Measure"): measure,
    })
    writer = PdfWriter(clone_from=PdfReader(pdf_path))
    writer.pages[0][NameObject("/VP")] = ArrayObject([vp])
    with open(pdf_path, "wb") as f:
        writer.write(f)


def has_viewport(pdf_path):
    page = PdfReader(pdf_path).pages[0]
    return "/VP" in page and page["/VP"][0].get_object()["/Measure"]["/Subtype"] == "/GEO"
