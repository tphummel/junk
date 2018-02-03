#!/usr/bin/env bash

set -o nounset
set -o errexit
set -o pipefail
IFS=$'\n\t'

main() {
  q -H -O -D "," -d "," "select a.id, a.league_id, a.course, a.player, a.finishPos, a.driver as d1, b.driver as d2 from csv/driver-perf.csv a join csv/driver-perf.csv b on (a.id = b.id and a.player = b.player and a.driver < b.driver)" > csv/drivers-perf.csv
}

main
