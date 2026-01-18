import io

from fastapi.testclient import TestClient

import api


def test_analyze_success(monkeypatch):
    def fake_analyze_face(path):
        return {"image": str(path), "face_detected": True}

    monkeypatch.setattr(api, "get_analyzer", lambda: fake_analyze_face)
    client = TestClient(api.app)

    response = client.post(
        "/analyze",
        files={"file": ("photo.jpg", io.BytesIO(b"image-bytes"), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json()["face_detected"] is True


def test_analyze_rejects_non_image():
    client = TestClient(api.app)

    response = client.post(
        "/analyze",
        files={"file": ("note.txt", io.BytesIO(b"hello"), "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "File must be an image"


def test_healthcheck():
    client = TestClient(api.app)

    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "Face Analysis API"}
