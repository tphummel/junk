#!/usr/bin/env python3
import sys
import json
import cv2
import mediapipe as mp
from pathlib import Path
import numpy as np
import os
from contextlib import redirect_stdout, redirect_stderr
from insightface.app import FaceAnalysis


def resolve_model_path():
    """Resolve the MediaPipe face landmarker model path."""
    env_path = os.environ.get("FACE_LANDMARKER_MODEL")
    if env_path:
        return env_path

    default_path = "/app/face_landmarker.task"
    if Path(default_path).exists():
        return default_path

    local_path = Path(__file__).with_name("face_landmarker.task")
    return str(local_path)


def analyze_face(image_path):
    """Analyze a face image and return structured data."""

    # Initialize MediaPipe Face Landmarker
    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    model_path = resolve_model_path()

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=VisionRunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True
    )

    # Read image
    image = mp.Image.create_from_file(str(image_path))

    # Detect faces
    with FaceLandmarker.create_from_options(options) as landmarker:
        results = landmarker.detect(image)

    if not results.face_landmarks:
        return {"error": "No face detected", "image": str(image_path)}

    # Extract data from first face
    face_landmarks = results.face_landmarks[0]

    # Calculate head pose (pitch, yaw, roll) from transformation matrix
    head_pose = {}
    if results.facial_transformation_matrixes:
        matrix = results.facial_transformation_matrixes[0]
        head_pose = calculate_head_pose(matrix)

    # Get specific landmark positions
    landmarks_dict = extract_key_landmarks(face_landmarks)

    # Get blendshapes (expressions/features)
    blendshapes_dict = {}
    if results.face_blendshapes:
        blendshapes_dict = {
            bs.category_name: float(bs.score)
            for bs in results.face_blendshapes[0]
        }

    # Analyze image properties
    cv_image = cv2.imread(str(image_path))
    if cv_image is None:
        raise ValueError(f"Unable to read image: {image_path}")
    image_props = analyze_image_properties(cv_image)

    # Analyze facial hair presence from blendshapes
    facial_hair_analysis = analyze_facial_hair(blendshapes_dict, face_landmarks, cv_image)

    # Analyze eye gaze direction
    eye_gaze = analyze_eye_gaze(blendshapes_dict)

    # Analyze facial expression
    facial_expression = analyze_facial_expression(blendshapes_dict)

    # Analyze with InsightFace for gender, age, and embeddings
    insightface_analysis = analyze_with_insightface(cv_image)

    # Convert all landmarks to list format
    all_landmarks_list = [
        {"x": float(lm.x), "y": float(lm.y), "z": float(lm.z)}
        for lm in face_landmarks
    ]

    # Compile results
    analysis = {
        "image": str(image_path),
        "face_detected": True,
        "head_pose": head_pose,
        "eye_gaze": eye_gaze,
        "facial_expression": facial_expression,
        "insightface": insightface_analysis,
        "key_landmarks": landmarks_dict,
        "all_landmarks": all_landmarks_list,
        "blendshapes": blendshapes_dict,
        "facial_hair_indicators": facial_hair_analysis,
        "image_properties": image_props,
        "total_landmarks": len(face_landmarks)
    }

    return analysis


def calculate_head_pose(transformation_matrix):
    """Calculate pitch, yaw, roll from transformation matrix."""
    matrix = np.array(transformation_matrix).reshape(4, 4)
    rotation = matrix[:3, :3]

    sy = np.sqrt(rotation[0, 0]**2 + rotation[1, 0]**2)

    singular = sy < 1e-6

    if not singular:
        pitch = np.arctan2(rotation[2, 1], rotation[2, 2])
        yaw = np.arctan2(-rotation[2, 0], sy)
        roll = np.arctan2(rotation[1, 0], rotation[0, 0])
    else:
        pitch = np.arctan2(-rotation[1, 2], rotation[1, 1])
        yaw = np.arctan2(-rotation[2, 0], sy)
        roll = 0

    return {
        "pitch_degrees": float(np.degrees(pitch)),
        "yaw_degrees": float(np.degrees(yaw)),
        "roll_degrees": float(np.degrees(roll))
    }


def extract_key_landmarks(face_landmarks):
    """Extract key facial landmarks."""
    # MediaPipe landmark indices
    LEFT_EYE = [33, 133, 160, 159, 158, 157, 173]
    RIGHT_EYE = [362, 263, 387, 386, 385, 384, 398]
    LEFT_EYEBROW = [70, 63, 105, 66, 107]
    RIGHT_EYEBROW = [300, 293, 334, 296, 336]
    NOSE_TIP = 1
    NOSE_BRIDGE = 6
    MOUTH_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
    MOUTH_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
    CHIN = 152
    LEFT_CHEEK = 205
    RIGHT_CHEEK = 425
    FOREHEAD = 10

    landmarks_dict = {
        "left_eye_center": get_landmark_avg(face_landmarks, LEFT_EYE),
        "right_eye_center": get_landmark_avg(face_landmarks, RIGHT_EYE),
        "left_eyebrow_center": get_landmark_avg(face_landmarks, LEFT_EYEBROW),
        "right_eyebrow_center": get_landmark_avg(face_landmarks, RIGHT_EYEBROW),
        "nose_tip": get_landmark_position(face_landmarks, NOSE_TIP),
        "nose_bridge": get_landmark_position(face_landmarks, NOSE_BRIDGE),
        "mouth_outer_center": get_landmark_avg(face_landmarks, MOUTH_OUTER),
        "mouth_inner_center": get_landmark_avg(face_landmarks, MOUTH_INNER),
        "chin": get_landmark_position(face_landmarks, CHIN),
        "left_cheek": get_landmark_position(face_landmarks, LEFT_CHEEK),
        "right_cheek": get_landmark_position(face_landmarks, RIGHT_CHEEK),
        "forehead": get_landmark_position(face_landmarks, FOREHEAD),
    }

    return landmarks_dict


def get_landmark_position(landmarks, index):
    """Get x, y, z position of a single landmark."""
    lm = landmarks[index]
    return {"x": float(lm.x), "y": float(lm.y), "z": float(lm.z)}


def get_landmark_avg(landmarks, indices):
    """Get average position of multiple landmarks."""
    x = sum(landmarks[i].x for i in indices) / len(indices)
    y = sum(landmarks[i].y for i in indices) / len(indices)
    z = sum(landmarks[i].z for i in indices) / len(indices)
    return {"x": float(x), "y": float(y), "z": float(z)}


def analyze_facial_hair(blendshapes, landmarks, image):
    """Analyze facial hair using texture analysis in relevant regions."""
    # Convert to grayscale for texture analysis
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Get key landmark positions in pixel coordinates
    nose_tip = landmarks[1]
    chin = landmarks[152]
    mouth_top = landmarks[0]  # Upper lip center
    mouth_bottom = landmarks[17]  # Lower lip center
    left_mouth = landmarks[61]
    right_mouth = landmarks[291]

    # Convert normalized coordinates to pixel coordinates
    def to_pixel(landmark):
        return int(landmark.x * w), int(landmark.y * h)

    nose_px = to_pixel(nose_tip)
    chin_px = to_pixel(chin)
    mouth_top_px = to_pixel(mouth_top)
    mouth_bottom_px = to_pixel(mouth_bottom)
    left_mouth_px = to_pixel(left_mouth)
    right_mouth_px = to_pixel(right_mouth)

    # Define mustache region (between nose and upper lip)
    mustache_region = extract_region(
        gray,
        x_center=(left_mouth_px[0] + right_mouth_px[0]) // 2,
        y_center=(nose_px[1] + mouth_top_px[1]) // 2,
        width=int(abs(right_mouth_px[0] - left_mouth_px[0]) * 1.2),
        height=int(abs(mouth_top_px[1] - nose_px[1]) * 1.5)
    )

    # Define beard region (below mouth to chin)
    beard_region = extract_region(
        gray,
        x_center=(left_mouth_px[0] + right_mouth_px[0]) // 2,
        y_center=(mouth_bottom_px[1] + chin_px[1]) // 2,
        width=int(abs(right_mouth_px[0] - left_mouth_px[0]) * 1.5),
        height=int(abs(chin_px[1] - mouth_bottom_px[1]) * 1.5)
    )

    # Analyze texture complexity in each region
    mustache_score = analyze_hair_texture(mustache_region) if mustache_region is not None else 0.0
    beard_score = analyze_hair_texture(beard_region) if beard_region is not None else 0.0

    analysis = {
        "mustache_probability": float(mustache_score),
        "beard_probability": float(beard_score),
        "has_mustache": bool(mustache_score > 0.5),
        "has_beard": bool(beard_score > 0.5),
        "method": "texture_analysis"
    }

    return analysis


def extract_region(image, x_center, y_center, width, height):
    """Extract a region of interest from the image."""
    h, w = image.shape

    x1 = max(0, x_center - width // 2)
    x2 = min(w, x_center + width // 2)
    y1 = max(0, y_center - height // 2)
    y2 = min(h, y_center + height // 2)

    if x2 <= x1 or y2 <= y1:
        return None

    return image[y1:y2, x1:x2]


def analyze_hair_texture(region):
    """Analyze texture complexity to detect facial hair."""
    if region is None or region.size == 0:
        return 0.0

    # Normalize region size for consistent analysis
    if region.shape[0] < 10 or region.shape[1] < 10:
        return 0.0

    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(region, (3, 3), 0)

    # Calculate edge density using Canny edge detection
    edges = cv2.Canny(blurred, 50, 150)
    edge_density = np.sum(edges > 0) / edges.size

    # Calculate texture variance (high variance = more texture)
    texture_variance = np.std(region)

    # Calculate local binary pattern-like metric
    # High frequency changes indicate hair texture
    dx = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=3)
    dy = cv2.Sobel(blurred, cv2.CV_64F, 0, 1, ksize=3)
    gradient_magnitude = np.sqrt(dx**2 + dy**2)
    mean_gradient = np.mean(gradient_magnitude)

    # Combine metrics with weights
    # Edge density: 0-1 range, weight 0.4
    # Texture variance: normalize to 0-1, weight 0.3
    # Gradient: normalize to 0-1, weight 0.3

    edge_score = min(edge_density * 15, 1.0)  # Scale edge density
    variance_score = min(texture_variance / 60, 1.0)  # Normalize variance
    gradient_score = min(mean_gradient / 40, 1.0)  # Normalize gradient

    # Combined score
    combined_score = (edge_score * 0.4 + variance_score * 0.3 + gradient_score * 0.3)

    # Apply sigmoid-like transformation for better probability distribution
    score = 1 / (1 + np.exp(-10 * (combined_score - 0.5)))

    return score


def analyze_eye_gaze(blendshapes):
    """Analyze eye gaze direction from blendshapes."""
    if not blendshapes:
        return {"gaze_direction": "unknown", "confidence": 0.0}

    # Extract eye look blendshapes
    look_up = (blendshapes.get("eyeLookUpLeft", 0) + blendshapes.get("eyeLookUpRight", 0)) / 2
    look_down = (blendshapes.get("eyeLookDownLeft", 0) + blendshapes.get("eyeLookDownRight", 0)) / 2
    look_in = (blendshapes.get("eyeLookInLeft", 0) + blendshapes.get("eyeLookInRight", 0)) / 2
    look_out = (blendshapes.get("eyeLookOutLeft", 0) + blendshapes.get("eyeLookOutRight", 0)) / 2

    # Determine dominant direction
    threshold = 0.3
    vertical = ""
    horizontal = ""

    if look_up > threshold:
        vertical = "up"
    elif look_down > threshold:
        vertical = "down"

    if look_out > threshold:
        horizontal = "left"
    elif look_in > threshold:
        horizontal = "right"

    if vertical and horizontal:
        gaze_direction = f"{vertical}-{horizontal}"
    elif vertical:
        gaze_direction = vertical
    elif horizontal:
        gaze_direction = horizontal
    else:
        gaze_direction = "center"

    max_component = max(look_up, look_down, look_out, look_in)
    confidence = float(max_component) if max_component > threshold else 0.0

    return {
        "gaze_direction": gaze_direction,
        "confidence": confidence,
        "vertical": float(look_up - look_down),  # positive = up, negative = down
        "horizontal": float(look_in - look_out),  # positive = right, negative = left
    }


def analyze_facial_expression(blendshapes):
    """Analyze facial expression indicators from blendshapes."""
    if not blendshapes:
        return {}

    # Smile indicators
    smile_left = blendshapes.get("mouthSmileLeft", 0)
    smile_right = blendshapes.get("mouthSmileRight", 0)
    smile_intensity = (smile_left + smile_right) / 2

    # Cheek raise (often accompanies genuine smiles)
    cheek_squint_left = blendshapes.get("cheekSquintLeft", 0)
    cheek_squint_right = blendshapes.get("cheekSquintRight", 0)
    cheek_raise_intensity = (cheek_squint_left + cheek_squint_right) / 2

    # Frown indicators
    frown_left = blendshapes.get("mouthFrownLeft", 0)
    frown_right = blendshapes.get("mouthFrownRight", 0)
    frown_intensity = (frown_left + frown_right) / 2

    # Mouth pucker
    mouth_pucker = blendshapes.get("mouthPucker", 0)

    return {
        "smile_intensity": float(smile_intensity),
        "cheek_raise_intensity": float(cheek_raise_intensity),
        "frown_intensity": float(frown_intensity),
        "mouth_pucker": float(mouth_pucker),
    }


def analyze_with_insightface(image):
    """Analyze face using InsightFace for gender, age, and embeddings."""
    # Initialize InsightFace with buffalo_l model (suppress verbose output)
    with open(os.devnull, 'w') as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
            app.prepare(ctx_id=0, det_size=(640, 640))

    # Detect faces
    faces = app.get(image)

    if not faces:
        return None

    # Use first detected face
    face = faces[0]

    # Extract bounding box
    bbox = face.bbox.astype(int).tolist()  # [x1, y1, x2, y2]

    # Extract gender (0=female, 1=male)
    gender = "male" if face.gender == 1 else "female"

    # Extract age
    age = int(face.age)

    # Extract detection score
    det_score = float(face.det_score)

    # Extract 512-D embedding
    embedding = face.embedding.tolist()

    return {
        "gender": gender,
        "age": age,
        "bounding_box": {
            "x1": bbox[0],
            "y1": bbox[1],
            "x2": bbox[2],
            "y2": bbox[3]
        },
        "detection_confidence": det_score,
        "embedding": embedding,
        "embedding_dimensions": len(embedding)
    }


def analyze_image_properties(image):
    """Analyze lighting and image quality."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Calculate brightness
    brightness = float(np.mean(gray))

    # Calculate contrast (standard deviation)
    contrast = float(np.std(gray))

    # Estimate sharpness (Laplacian variance)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    sharpness = float(laplacian.var())

    # Color analysis
    mean_color = image.mean(axis=0).mean(axis=0)

    return {
        "brightness": brightness,
        "contrast": contrast,
        "sharpness": sharpness,
        "mean_color_bgr": {
            "blue": float(mean_color[0]),
            "green": float(mean_color[1]),
            "red": float(mean_color[2])
        },
        "resolution": {"width": image.shape[1], "height": image.shape[0]}
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: analyze_face.py <image_path>", file=sys.stderr)
        sys.exit(1)

    image_path = Path(sys.argv[1])

    if not image_path.exists():
        print(f"Error: Image not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    try:
        result = analyze_face(image_path)
        print(json.dumps(result, indent=2))
    except Exception as e:
        error_result = {
            "error": str(e),
            "image": str(image_path)
        }
        print(json.dumps(error_result, indent=2), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
