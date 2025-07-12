#!/usr/bin/env bash
set -euo pipefail

REPOS=(
  "tphummel/blog"
  "tphummel/data.tomhummel.com"
  "tphummel/mlb.tomhummel.com"
  "tphummel/wordle"
  "tphummel/oldgames.win"
  "lapsrun/laps.run"
)

for REPO in "${REPOS[@]}"; do
  echo "🔍 Checking $REPO"

  RAW_URL="https://raw.githubusercontent.com/${REPO}/main/.tool-versions"

  if CONTENT=$(curl -fsSL "$RAW_URL"); then
    HUGO_VER=$(echo "$CONTENT" | awk '$1 == "hugo" { print $2 }')

    if [[ -n "${HUGO_VER:-}" ]]; then
      echo "✅ $REPO — Hugo version: $HUGO_VER"
    else
      echo "⚠️  $REPO — .tool-versions found but no Hugo entry"
    fi
  else
    echo "❌ $REPO — .tool-versions file not found or repo inaccessible"
  fi

  echo
done
