from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pathlib import Path
import shutil
import tempfile

app = FastAPI(title="Face Analysis API")


def get_analyzer():
    from analyze_face import analyze_face

    return analyze_face


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
