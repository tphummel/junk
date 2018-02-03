#!/usr/bin/env bash

###
# my workaround for lack of UNION query
# `make-driver-perf.sh` ALL LEAGUES. specify 16001, 17001 for baby park only
# driver-perf.csv table (pseudocode):
# ```
# empty file, write header
# for i in 1..4
#   run query i driver1 >> file
#   run query i driver2 >> file
# ```
###

set -o nounset
set -o errexit
set -o pipefail
IFS=$'\n\t'

main() {
  local outfile="./csv/driver-perf.csv"
  echo "league_id,id,submitDate,player,driver,finishPos,course" > "$outfile"

  for i in $(seq 1 4); do
    echo "running query: $i"
    # TODO: print header if $i == 1
    q -H -D "," -d "," "SELECT   m.league_id AS league_id, m.league_id ||'_' ||m.cluster_id ||'_' ||m.seq AS id, m.submitDate, p1.name    AS player, f1.driver1 AS driver, $i as finishPos, m.course FROM     csv/match.csv m JOIN     csv/perf.csv f1 JOIN     csv/player.csv p1 ON       ( f1.finishpos = $i AND      f1.match_id = m.match_id AND      f1.league_id = m.league_id AND      p1.league_id = f1.league_id AND      p1.player_id = f1.player_id)" >> "$outfile"
    q -H -D "," -d "," "SELECT   m.league_id AS league_id, m.league_id ||'_' ||m.cluster_id ||'_' ||m.seq AS id, m.submitDate, p1.name    AS player, f1.driver2 AS driver, $i as finishPos, m.course FROM     csv/match.csv m JOIN     csv/perf.csv f1 JOIN     csv/player.csv p1 ON       ( f1.finishpos = $i AND      f1.match_id = m.match_id AND      f1.league_id = m.league_id AND      p1.league_id = f1.league_id AND      p1.player_id = f1.player_id)" >> "$outfile"
  done

}

main
