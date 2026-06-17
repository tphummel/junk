#!/usr/bin/env bash
set -o nounset
set -o errexit
set -o pipefail
IFS=$'\n\t'

set -x

main(){
  local destination="content/game/$(uuidgen).md"
  echo "---" > "$destination"
  node bin/game.js team3 team4 | yq r - >> "$destination"
  echo "---" >> "$destination"
}

main
