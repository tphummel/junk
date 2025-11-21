# Face Analysis Toolkit

A lightweight containerized utility that uses [MediaPipe](https://developers.google.com/mediapipe) and OpenCV to extract facial landmarks, blendshape scores, estimated head pose, and basic image quality metrics from a single photograph.

## Features
- Detects a single face and exposes 468 MediaPipe landmarks with easy-to-consume key points.
- Calculates estimated pitch/yaw/roll angles from MediaPipe's facial transformation matrix.
- Reports MediaPipe blendshape scores that reflect facial expressions.
- Provides heuristics for facial hair analysis and high-level image quality measurements (brightness, contrast, sharpness, color balance, resolution).
- Ships in a Docker image that bundles the MediaPipe face landmarker model for offline use.

## Quick Start
```bash
docker run --rm -v "$(pwd):/images:ro" ghcr.io/tphummel/face-analysis:latest /images/photo.jpg > output.json
```

Replace `photo.jpg` with your image filename. The analysis results will be written to `output.json`.

## Project layout
```
face-analysis/
├── analyze_face.py        # CLI utility that runs the analysis
├── requirements.txt       # Python dependencies for the CLI
├── Dockerfile             # Builds the runtime image (includes model download)
└── README.md              # This file
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

## Continuous integration
The repository ships with a GitHub Actions workflow that:
1. Installs Python dependencies and performs a basic compilation check on every push/pull request that touches the `face-analysis` directory.
2. Builds the Docker image using Buildx to ensure the Dockerfile remains valid.
3. Publishes the container to GitHub Container Registry (`ghcr.io/<owner>/face-analysis:latest`) whenever the `main` branch is updated.

## Output
The CLI prints a JSON document with:
- The resolved image path and whether a face was detected.
- Head pose angles in degrees.
- Landmark coordinates for key facial regions.
- Blendshape scores with MediaPipe's category labels.
- Image statistics and heuristic facial hair indicators.

Use the JSON file as input to downstream automation, dashboards, or analytics pipelines.
