#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://face.hummel.casa"
INPUT_DIR=""
OUTPUT_DIR=""
RECURSIVE=0
OVERWRITE=0
TIMEOUT=120
CURL_OPTS=()
WRITE_META=1

usage() {
  cat <<'EOF'
Usage:
  process_daily_faces.sh --input DIR --output DIR [options]

Options:
  --base-url URL        Base URL (default: https://face.hummel.casa)
  --input DIR           Mounted directory containing images (e.g. /mnt/daily-face-pictures)
  --output DIR          Output directory root
  --recursive           Recurse into subdirectories
  --overwrite           Recompute even if outputs exist
  --timeout SECONDS     Curl max-time (default: 120)
  --header "K: V"       Extra HTTP header (repeatable)
  --no-meta             Do not write meta.json parsed from filename
  -h, --help            Show help

Outputs per image:
  OUTPUT_DIR/<filename without extension>/analysis.json
  OUTPUT_DIR/<filename without extension>/annotated.png
  OUTPUT_DIR/<filename without extension>/meta.json        (unless --no-meta)

Notes:
  - Folder name is the original filename without the file extension.
  - Duplicate filenames across folders will collide.
EOF
}

is_image() {
  local f="$1"
  shopt -s nocasematch
  [[ "$f" =~ \.(jpg|jpeg|png|webp|bmp|tif|tiff)$ ]]
}

out_folder_name() {
  local f="$1"
  local base
  base="$(basename "$f")"
  echo "${base%.*}"
}

# Parse filenames like:
# 20260125T040724-0800__34.02127363641493__-118.4203244617564.jpeg
# Produces: ts="20260125T040724-0800" lat="34.0..." lon="-118.4..."
parse_filename_meta() {
  local base="$1"
  local name="${base%.*}"  # strip extension
  local ts lat lon
  ts="${name%%__*}"        # before first __
  local rest="${name#*__}" # after first __
  lat="${rest%%__*}"       # before second __
  lon="${rest#*__}"        # after second __
  echo "$ts" "$lat" "$lon"
}

write_meta_json() {
  local out_dir="$1"
  local filename="$2"

  local ts lat lon
  read -r ts lat lon < <(parse_filename_meta "$filename")

  # Only write meta if it looks like our pattern
  if [[ "$ts" == "$filename" || -z "$lat" || -z "$lon" ]]; then
    return 0
  fi

  cat > "$out_dir/meta.json" <<EOF
{
  "filename": "$(printf '%s' "$filename" | sed 's/\\/\\\\/g; s/"/\\"/g')",
  "timestamp": "$ts",
  "lat": $lat,
  "lon": $lon
}
EOF
}

analyze_one() {
  local img="$1"
  local out_root="$2"

  local filename
  filename="$(basename "$img")"
  local folder_name
  folder_name="$(out_folder_name "$img")"
  local out_dir="$out_root/$folder_name"
  local analysis_json="$out_dir/analysis.json"
  local annotated_png="$out_dir/annotated.png"

  mkdir -p "$out_dir"

  if [[ $WRITE_META -eq 1 ]]; then
    # best-effort; doesn’t fail job if parsing doesn’t match
    write_meta_json "$out_dir" "$filename" || true
  fi

  if [[ $OVERWRITE -eq 0 && -s "$analysis_json" && -s "$annotated_png" ]]; then
    echo "SKIP: $filename (already has outputs)"
    return 0
  fi

  echo "PROCESS: $filename"

  curl -sS --fail --max-time "$TIMEOUT" \
    "${CURL_OPTS[@]}" \
    -X POST "$BASE_URL/analyze" \
    -F "file=@${img}" \
    -o "$analysis_json"

  curl -sS --fail --max-time "$TIMEOUT" \
    "${CURL_OPTS[@]}" \
    -X POST "$BASE_URL/analyze/annotated" \
    -F "file=@${img}" \
    -o "$annotated_png"

  echo "  -> $analysis_json"
  echo "  -> $annotated_png"
}

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2;;
    --input) INPUT_DIR="$2"; shift 2;;
    --output) OUTPUT_DIR="$2"; shift 2;;
    --recursive) RECURSIVE=1; shift;;
    --overwrite) OVERWRITE=1; shift;;
    --timeout) TIMEOUT="$2"; shift 2;;
    --header) CURL_OPTS+=(-H "$2"); shift 2;;
    --no-meta) WRITE_META=0; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2;;
  esac
done

if [[ -z "$INPUT_DIR" || -z "$OUTPUT_DIR" ]]; then
  echo "ERROR: --input and --output are required" >&2
  usage
  exit 2
fi

INPUT_DIR="$(cd "$INPUT_DIR" && pwd)"
OUTPUT_DIR="$(mkdir -p "$OUTPUT_DIR" && cd "$OUTPUT_DIR" && pwd)"

echo "Base URL:   $BASE_URL"
echo "Input dir:  $INPUT_DIR"
echo "Output dir: $OUTPUT_DIR"
echo

if [[ $RECURSIVE -eq 1 ]]; then
  while IFS= read -r -d '' f; do
    if is_image "$f"; then
      analyze_one "$f" "$OUTPUT_DIR" || echo "ERROR: failed: $f" >&2
    fi
  done < <(find "$INPUT_DIR" -type f -print0)
else
  shopt -s nullglob
  for f in "$INPUT_DIR"/*; do
    [[ -f "$f" ]] || continue
    if is_image "$f"; then
      analyze_one "$f" "$OUTPUT_DIR" || echo "ERROR: failed: $f" >&2
    fi
  done
fi

echo "Done."