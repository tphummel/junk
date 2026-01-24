from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pathlib import Path
import shutil
import tempfile
import cv2
import io

app = FastAPI(title="Face Analysis API")


def get_analyzer():
    from analyze_face import analyze_face

    return analyze_face


def draw_landmarks(image_path, landmarks):
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Unable to read image: {image_path}")

    height, width = image.shape[:2]
    color = (0, 0, 255)
    radius = 2
    thickness = -1

    for landmark in landmarks:
        x = int(landmark["x"] * width)
        y = int(landmark["y"] * height)
        cv2.circle(image, (x, y), radius, color, thickness)

    success, buffer = cv2.imencode(".png", image)
    if not success:
        raise ValueError("Unable to encode annotated image")

    return buffer.tobytes()


@app.get("/healthz")
def healthcheck():
    return {"status": "ok", "service": app.title}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    suffix = Path(file.filename or "upload.jpg").suffix or ".jpg"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        result = get_analyzer()(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    return JSONResponse(content=result)


@app.post("/analyze/annotated")
async def analyze_annotated(file: UploadFile = File(...)):
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    suffix = Path(file.filename or "upload.jpg").suffix or ".jpg"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        result = get_analyzer()(tmp_path)
        if not result.get("face_detected"):
            raise HTTPException(status_code=422, detail="No face detected")
        annotated_bytes = draw_landmarks(tmp_path, result["all_landmarks"])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    return StreamingResponse(io.BytesIO(annotated_bytes), media_type="image/png")
