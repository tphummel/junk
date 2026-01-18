# Face Analysis Toolkit

A comprehensive containerized face analysis tool combining [MediaPipe](https://developers.google.com/mediapipe) and [InsightFace](https://github.com/deepinsight/insightface) to extract detailed facial information from photographs. Provides facial landmarks, expressions, demographics, identity embeddings, and quality metrics in a single JSON output.

## Features

### Face Detection & Landmarks
- **478 3D facial landmarks** from MediaPipe (full face mesh)
- **Key landmark extraction** for eyes, nose, mouth, chin, cheeks, forehead
- **Face bounding box** coordinates from InsightFace

### Demographics & Identity
- **Gender identification** (male/female) using InsightFace buffalo_l model
- **Age estimation** from InsightFace
- **512-dimensional face embeddings** for identity comparison and face recognition
- **Detection confidence score**

### Expression & Gaze Analysis
- **52 blendshapes** from MediaPipe (detailed facial expression scores)
- **Eye gaze direction** (center, up, down, left, right, combinations)
- **Facial expression indicators** (smile intensity, cheek raise, frown, mouth pucker)
- **Head pose estimation** (pitch, yaw, roll in degrees)

### Physical Features
- **Facial hair detection** using texture analysis (mustache/beard probabilities)

### Image Quality
- **Brightness, contrast, sharpness** measurements
- **Color balance** (mean RGB values)
- **Image resolution**

### Visualization
- **Landmark overlay script** (`visualize_landmarks.sh`) to annotate images with all 478 landmarks using ImageMagick

All models bundled in Docker image for offline use.

## Quick Start
```bash
docker run --rm -v "$(pwd):/images:ro" ghcr.io/tphummel/face-analysis:latest /images/photo.jpg > output.json
```

Replace `photo.jpg` with your image filename. The analysis results will be written to `output.json`.

## Project layout
```
face-analysis/
├── analyze_face.py           # Main analysis CLI
├── visualize_landmarks.sh    # ImageMagick script to overlay landmarks on images
├── requirements.txt          # Python dependencies (MediaPipe, InsightFace, OpenCV)
├── Dockerfile                # Container build (includes MediaPipe + InsightFace models)
└── README.md                 # This file
```

## Local development
1. **Install dependencies** (Python 3.11+ recommended):
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

2. **Download the MediaPipe model** (matches the Docker build):
   ```bash
   curl -L -o face_landmarker.task \
     https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
   ```

3. **Run the analyzer**:
   ```bash
   python analyze_face.py /path/to/image.jpg > output.json
   ```

## Docker usage
Build and run the container to keep dependencies isolated:
```bash
docker build -t face-analyzer ./face-analysis
docker run --rm -v "$(pwd):/images:ro" face-analyzer /images/photo.jpg > output.json
```

## HTTP API
Run a local API server that accepts an image upload and returns the JSON analysis:
```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

Send an image for analysis:
```bash
curl -s -X POST http://localhost:8000/analyze \
  -F "file=@/path/to/photo.jpg" | jq .
```

Example: curl a local face photo and capture the analysis payload:
```bash
curl -s -X POST http://localhost:8000/analyze \
  -F "file=@/path/to/face.jpg" \
  -o analysis.json
```

You can also inspect a few key fields directly:
```bash
curl -s -X POST http://localhost:8000/analyze \
  -F "file=@/path/to/face.jpg" | jq '{face_detected, insightface: {age, gender}, head_pose}'
```

### Docker API usage
Override the container entrypoint to run the API:
```bash
docker build -t face-analyzer ./face-analysis
docker run --rm -p 8000:8000 face-analyzer \
  uvicorn api:app --host 0.0.0.0 --port 8000
```

## Visualization
Use the included `visualize_landmarks.sh` script to overlay all 478 facial landmarks on an image:

```bash
./visualize_landmarks.sh input.jpg analysis.json annotated.jpg
```

**Requirements:** ImageMagick and jq must be installed.

The script:
- Draws red dots for all 478 landmarks
- Uses the landmark coordinates from your JSON output
- Creates a visual confirmation of face detection accuracy
- Helpful for debugging and verifying landmark placement

## Continuous integration
The repository ships with a GitHub Actions workflow that:
1. Installs Python dependencies and performs a basic compilation check on every push/pull request that touches the `face-analysis` directory.
2. Builds the Docker image using Buildx to ensure the Dockerfile remains valid.
3. Publishes the container to GitHub Container Registry (`ghcr.io/<owner>/face-analysis:latest` and `ghcr.io/<owner>/face-analysis:<short-sha>`) whenever the `main` branch is updated.

## Output
The CLI prints a JSON document with comprehensive facial analysis data:

### Core Detection
- `face_detected`: boolean indicating if a face was found
- `image`: path to analyzed image

### InsightFace Analysis
- `insightface.gender`: "male" or "female"
- `insightface.age`: estimated age (integer)
- `insightface.bounding_box`: face location (x1, y1, x2, y2)
- `insightface.detection_confidence`: detection score (0-1)
- `insightface.embedding`: 512-dimensional identity vector (for face comparison)

### MediaPipe Landmarks
- `all_landmarks`: all 478 facial landmarks (x, y, z coordinates)
- `key_landmarks`: pre-selected important points (eyes, nose, mouth, chin, etc.)
- `total_landmarks`: count of detected landmarks

### Expression & Pose
- `head_pose`: pitch, yaw, roll angles in degrees
- `eye_gaze`: gaze direction and confidence (center/up/down/left/right)
- `facial_expression`: smile intensity, cheek raise, frown, mouth pucker (0-1 scores)
- `blendshapes`: 52 detailed expression coefficients from MediaPipe

### Physical Features
- `facial_hair_indicators`: mustache and beard probabilities (texture-based detection)

### Image Quality
- `image_properties`: brightness, contrast, sharpness, color balance, resolution

### Example Output Structure
```json
{
  "image": "/images/photo.jpg",
  "face_detected": true,
  "insightface": {
    "gender": "male",
    "age": 28,
    "bounding_box": {"x1": 100, "y1": 50, "x2": 300, "y2": 250},
    "detection_confidence": 0.98,
    "embedding": [0.123, -0.456, ...],
    "embedding_dimensions": 512
  },
  "head_pose": {
    "pitch_degrees": 5.2,
    "yaw_degrees": -3.1,
    "roll_degrees": 0.8
  },
  "eye_gaze": {
    "gaze_direction": "center",
    "confidence": 0.85
  },
  "facial_expression": {
    "smile_intensity": 0.72,
    "cheek_raise_intensity": 0.65,
    "frown_intensity": 0.03,
    "mouth_pucker": 0.01
  },
  "facial_hair_indicators": {
    "mustache_probability": 0.15,
    "beard_probability": 0.82,
    "has_mustache": false,
    "has_beard": true
  }
}
```

Use the JSON output for downstream automation, analytics pipelines, face recognition systems, or demographic analysis.
