import shapely

from usmaps.config import derive_thresholds, enabled_states, fit_scale, load_state
from usmaps.labels import Placer, rect
from usmaps.process import classify_way, parse_refs
from usmaps.render import nice_scalebar


def test_parse_refs():
    assert parse_refs("I 95;US 13") == [("I", "95"), ("US", "13")]
    assert parse_refs("DE 1") == [("DE", "1")]
    assert parse_refs("PA-611") == [("PA", "611")]
    assert parse_refs("PA 611 Truck") == []
    assert parse_refs(None) == []


def test_classify_way():
    p = {"DE"}
    assert classify_way("I 95;DE 1", "motorway", p) == ("interstate", "I-95")
    assert classify_way("US 13;DE 1", "primary", p) == ("state_route", "DE-1")
    assert classify_way("US 13", "primary", p) == ("other", None)
    assert classify_way("PA 3", "primary", p) == ("other", None)


def test_pilot_configs():
    de, pa = load_state("DE"), load_state("PA")
    assert de["orientation"] == "portrait" and de["map_trim_cm"] == [12.0, 18.0]
    assert pa["orientation"] == "landscape" and pa["map_trim_cm"] == [18.0, 12.0]
    assert set(enabled_states()) >= {"DE", "PA"}


def test_fit_scale_and_thresholds():
    # 90 km x 155 km state into 12 x 18 cm with 7 % padding
    s = fit_scale((0, 0, 60_000, 155_000), (12, 18), 7, 10_000)
    assert s == 930_000
    t = derive_thresholds({"thresholds": {}}, 900_000)
    assert t["min_road_length_m"] == 900
    assert t["simplification_m"] == 180
    assert t["label_spacing_m"] == 18_000


def test_scalebar_is_round():
    assert nice_scalebar(900_000) == 20
    assert nice_scalebar(2_800_000) == 50


def test_placer_rejects_collisions():
    p = Placer((120, 180), 1.0, 0.15, "DejaVu Sans")
    a = p.place_city("Dover", 60, 90, 1.4, 5.0, 0.4, [])
    assert a is not None
    b = p.place_city("Camden", 60.5, 90, 0.7, 5.0, 0.4, [])
    assert b is None or not b["box"].intersects(a["box"])
    assert p.fits(rect(10, 10, 5, 2)) and not p.fits(rect(0, 0, 5, 2))


def test_route_label_follows_straight_run():
    p = Placer((120, 180), 1.0, 0.15, "DejaVu Sans")
    line = shapely.LineString([(20, 20), (20, 120)])
    lab = p.place_route("I-95", [line], "interstate", 5.0, 0.4, 0.35, 11)
    assert lab is not None and abs(lab["angle"] - 90) < 1e-6
    short = shapely.LineString([(80, 20), (84, 20)])
    assert p.place_route("DE-9", [short], "state_route", 5.0, 0.35, 0.3, 11) is None
