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


def test_cli_logs_csv(tmp_path, capsys):
    src = tmp_path / "a.json"
    src.write_text(json.dumps(perfect()))
    log = tmp_path / "scores.csv"

    assert sf.main([str(src), "--log", str(log), "--date", "2026-11-28"]) == 0
    assert sf.main([str(src), "--log", str(log), "--date", "2026-11-29"]) == 0

    rows = list(csv.reader(log.open()))
    assert rows[0][:3] == ["date", "file", "total"]
    assert [r[0] for r in rows[1:]] == ["2026-11-28", "2026-11-29"]
    assert "100.0 / 100" in capsys.readouterr().out
