#!/bin/bash
set -e

if [ $# -lt 3 ]; then
    echo "Usage: visualize_landmarks.sh <input_image> <json_file> <output_image>"
    exit 1
fi

INPUT_IMAGE="$1"
JSON_FILE="$2"
OUTPUT_IMAGE="$3"

echo "Input image: $INPUT_IMAGE"
echo "JSON file: $JSON_FILE"
echo "Output image: $OUTPUT_IMAGE"
echo ""

# Get image dimensions
WIDTH=$(identify -format "%w" "$INPUT_IMAGE")
HEIGHT=$(identify -format "%h" "$INPUT_IMAGE")
echo "Image dimensions: ${WIDTH}x${HEIGHT}"
echo ""

# Extract landmarks and build draw commands
echo "Extracting landmarks from JSON..."
DRAW_COMMANDS=""
while IFS= read -r line; do
    DRAW_COMMANDS+="$line "
done < <(jq -r --arg w "$WIDTH" --arg h "$HEIGHT" '
  .all_landmarks[] |
  "circle \((.x * ($w | tonumber)) | floor),\((.y * ($h | tonumber)) | floor) \((.x * ($w | tonumber)) | floor + 2),\((.y * ($h | tonumber)) | floor)"
' "$JSON_FILE")

if [ -z "$DRAW_COMMANDS" ]; then
    echo "ERROR: No landmarks found in JSON"
    exit 1
fi

echo "Found landmarks, sample draw command:"
echo "$DRAW_COMMANDS" | head -c 200
echo "..."
echo ""

# Draw landmarks on image
echo "Drawing landmarks on image..."
convert "$INPUT_IMAGE" \
  -fill red \
  -stroke red \
  -strokewidth 2 \
  -draw "$DRAW_COMMANDS" \
  "$OUTPUT_IMAGE"

echo ""
echo "Saved annotated image to $OUTPUT_IMAGE"
