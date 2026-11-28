import csv
import json
import os
import sys

import pytest

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import score_face as sf


def perfect():
    return {
        "face_detected": True,
        "head_pose": {"pitch_degrees": 0, "yaw_degrees": 0, "roll_degrees": 0},
        "blendshapes": {"mouthSmileLeft": 0, "jawOpen": 0, "browDownLeft": 0},
        "facial_hair_indicators": {"mustache_probability": 0, "beard_probability": 0},
    }


def test_ramp():
    assert sf.ramp(0, 2, 15) == 1
    assert sf.ramp(2, 2, 15) == 1
    assert sf.ramp(15, 2, 15) == 0
    assert sf.ramp(8.5, 2, 15) == pytest.approx(0.5)


def test_perfect_scores_100():
    assert sf.score_result(perfect())["total"] == pytest.approx(100)


def test_pose_is_symmetric_and_penalised():
    r = perfect()
    r["head_pose"] = {"pitch_degrees": -15, "yaw_degrees": 0, "roll_degrees": 0}
    scored = sf.score_result(r)
    assert scored["parts"]["pose"]["score"] == pytest.approx(200 / 3)
    r["head_pose"]["pitch_degrees"] = 15
    assert sf.score_result(r)["parts"]["pose"]["score"] == pytest.approx(200 / 3)


def test_facial_hair_and_expression_lower_score():
    r = perfect()
    r["facial_hair_indicators"] = {"mustache_probability": 1, "beard_probability": 1}
    r["blendshapes"]["jawOpen"] = 0.5
    scored = sf.score_result(r)
    assert scored["parts"]["facial_hair"]["score"] == 0
    assert scored["parts"]["expression"]["score"] == pytest.approx(200 / 3)
    assert scored["total"] == pytest.approx((100 + 200 / 3 + 0) / 3)


def test_no_face_raises():
    with pytest.raises(ValueError, match="No face"):
        sf.score_result({"error": "No face detected"})


def test_missing_blendshapes_raises():
    r = perfect()
    r["blendshapes"] = {}
    with pytest.raises(ValueError):
        sf.score_result(r)


def write_day(directory, name, **overrides):
    r = perfect()
    r.update(overrides)
    (directory / name).write_text(json.dumps(r))


def test_directory_trend_groups_by_day_with_median(tmp_path, capsys):
    bad_hair = {"mustache_probability": 1, "beard_probability": 1}
    write_day(tmp_path, "2026-11-01_a.json", facial_hair_indicators=bad_hair)
    write_day(tmp_path, "2026-11-01_b.json", facial_hair_indicators=bad_hair)
    write_day(tmp_path, "2026-11-01_c.json")  # median of the 3 shots is still the bad one
    write_day(tmp_path, "20261102.json")
    (tmp_path / "notes.txt").write_text("ignored")

    assert sf.main([str(tmp_path)]) == 0

    out = capsys.readouterr().out
    assert "2026-11-01     3" in out and "2026-11-02     1" in out
    assert "days: 2" in out and "change since first day: +33.3" in out


def test_date_from_name_or_mtime(tmp_path):
    assert sf.date_of(tmp_path / "x-2026-11-05-y.json") == "2026-11-05"
    assert sf.date_of(tmp_path / "20261106.json") == "2026-11-06"
    f = tmp_path / "plain.json"
    f.write_text("{}")
    assert len(sf.date_of(f)) == 10


def test_log_is_idempotent(tmp_path):
    write_day(tmp_path, "2026-11-01.json")
    write_day(tmp_path, "2026-11-02.json")
    log = tmp_path / "scores.csv"

    assert sf.main([str(tmp_path), "--log", str(log)]) == 0
    assert sf.main([str(tmp_path), "--log", str(log)]) == 0

    rows = list(csv.reader(log.open()))
    assert rows[0][:3] == ["date", "file", "total"]
    assert [r[0] for r in rows[1:]] == ["2026-11-01", "2026-11-02"]


def test_single_file_report_and_bad_file_status(tmp_path, capsys):
    write_day(tmp_path, "2026-11-01.json")
    assert sf.main([str(tmp_path / "2026-11-01.json")]) == 0
    assert "100.0 / 100" in capsys.readouterr().out

    (tmp_path / "bad.json").write_text(json.dumps({"error": "No face detected"}))
    assert sf.main([str(tmp_path / "bad.json")]) == 1
