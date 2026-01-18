import sys
import types

import numpy as np
import pytest

sys.modules.setdefault("cv2", types.ModuleType("cv2"))
sys.modules.setdefault("mediapipe", types.ModuleType("mediapipe"))

insightface_module = types.ModuleType("insightface")
insightface_app_module = types.ModuleType("insightface.app")
insightface_app_module.FaceAnalysis = object
insightface_module.app = insightface_app_module
sys.modules.setdefault("insightface", insightface_module)
sys.modules.setdefault("insightface.app", insightface_app_module)

from analyze_face import calculate_head_pose, extract_region


def test_calculate_head_pose_identity():
    identity = np.eye(4).reshape(-1).tolist()
    pose = calculate_head_pose(identity)

    assert pose["pitch_degrees"] == pytest.approx(0.0, abs=1e-6)
    assert pose["yaw_degrees"] == pytest.approx(0.0, abs=1e-6)
    assert pose["roll_degrees"] == pytest.approx(0.0, abs=1e-6)


def test_extract_region_bounds():
    image = np.zeros((10, 10), dtype=np.uint8)
    region = extract_region(image, x_center=5, y_center=5, width=4, height=4)

    assert region.shape == (4, 4)
