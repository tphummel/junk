# reports

- two posts (kart DD: the first 1100 races (2010-2013)):
  1. no mention of human/player names (broadly interesting)
    - global:
      - course distribution
        ```
        q -H -O -D "," -d "," "select m.course, COUNT(m.match_id) as ct from csv/cluster.csv c join csv/match.csv m join csv/league.csv l on (c.season_id = m.season_id and c.league_id = m.league_id and c.cluster_id = m.cluster_id and l.league_id = c.league_id and l.league_id = m.league_id) group by m.course order by ct desc" > reports/global/course-dist.csv
        ```
      - course difficulty: (volatility on 150cc 2P GP All Cup)
        ```
        q -H -O -D "," -d "," "select m.course, COUNT(f.match_id) as races, SUM(CASE WHEN f.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN f.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN f.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN f.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(CASE WHEN f.finishPos = 5 THEN 1 ELSE 0 END) as f5, SUM(CASE WHEN f.finishPos = 6 THEN 1 ELSE 0 END) as f6, SUM(CASE WHEN f.finishPos = 7 THEN 1 ELSE 0 END) as f7, SUM(CASE WHEN f.finishPos = 8 THEN 1 ELSE 0 END) as f8, SUM(s.pts) as pts from csv/perf.csv f join csv/player.csv p join csv/score.csv s join csv/match.csv m on (m.match_id = f.match_id and m.cluster_id = f.cluster_id and m.league_id = f.league_id and s.league_id = p.league_id and s.finishPos = f.finishPos and f.league_id = p.league_id and f.player_id = p.player_id) where p.league_id in (11001) group by m.course order by pts asc" > reports/global/course-difficulty.csv
        ```
      - kart distribution
        ```
        q -H -O -D "," -d "," "select p.kart, COUNT(p.perf_id) as ct from csv/perf.csv p group by p.kart order by ct desc" > reports/global/kart-dist.csv
        ```
      - character distribution:
        - solo:
        ```
        q -H -O -D "," -d "," "SELECT p.driver, COUNT(p.id) as ct FROM     csv/driver-perf.csv p group by p.driver order by ct desc" > reports/global/driver-dist.csv
        ```
        - duo:
        ```
        q -H -O -D "," -d "," "SELECT d1, d2, COUNT(id) as ct FROM     csv/drivers-perf.csv p group by d1, d2 order by ct desc" > reports/global/drivers-dist.csv
        ```

    - 4p frantic baby only (official+unofficial):
      - usage, win pct by kart
      ```
      q -H -O -D "," -d "," "SELECT p.kart, COUNT(p.perf_id) as ct, SUM(CASE WHEN p.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN p.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN p.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN p.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(s.pts) as pts, ROUND(SUM(s.pts)*1.0/COUNT(p.perf_id),4) as ppr FROM     csv/perf.csv p JOIN csv/score.csv s ON (s.league_id = p.league_id and s.finishPos = p.finishPos) WHERE p.league_id in (16001, 17001) GROUP BY p.kart ORDER BY ppr DESC" > reports/baby/kart-dist.csv
      ```

      - usage, win pct by driver solo
      ```
      q -H -O -D "," -d "," "SELECT p.driver, COUNT(p.id) as ct, SUM(CASE WHEN p.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN p.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN p.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN p.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(s.pts) as pts, ROUND(SUM(s.pts)*1.0/COUNT(p.id),4) as ppr FROM     csv/driver-perf.csv p JOIN csv/score.csv s ON (s.league_id = p.league_id and s.finishPos = p.finishPos) where p.league_id in (16001, 17001) group by p.driver order by ppr desc" > reports/baby/driver-dist.csv
      ```

      - usage, win pct by driver duo
      ```
      q -H -O -D "," -d "," "SELECT d1, d2, COUNT(id) AS ct, SUM(CASE WHEN p.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN p.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN p.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN p.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(s.pts) as pts, ROUND(SUM(s.pts)*1.0/COUNT(p.id),4) as ppr FROM csv/drivers-perf.csv p JOIN csv/score.csv s ON (s.league_id = p.league_id and s.finishPos = p.finishPos) WHERE p.league_id IN (16001, 17001) GROUP BY d1, d2 ORDER BY ct desc" > reports/baby/drivers-dist.csv
      ```

  2. player names allowed (interesting for my friends only)
    - baby only (official+unofficial):
      - overall standings
      ```
      q -H -O -D "," -d "," "select p.name, COUNT(f.match_id) as races, SUM(CASE WHEN f.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN f.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN f.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN f.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(s.pts) as pts, ROUND(SUM(s.pts)*1.0/COUNT(f.match_id),4) as ppr from csv/perf.csv f join csv/player.csv p join csv/score.csv s on (s.league_id = p.league_id and s.finishPos = f.finishPos and f.league_id = p.league_id and f.player_id = p.player_id) where p.league_id in (16001, 17001) group by p.name order by ppr desc" > reports/baby-private/standings.csv
      ```

      - h2h matrix (gap pts)
      ```
      q -H -O -D "," -d "," "SELECT pa.name AS player, pb.name AS opp, SUM(b.finishPos-a.finishPos) AS gap FROM csv/perf.csv a JOIN csv/player.csv pa JOIN csv/perf.csv b JOIN csv/player.csv pb ON (pa.league_id = a.league_id and pa.player_id = a.player_id and b.league_id = pb.league_id and b.player_id = pb.player_id and a.match_id = b.match_id and a.league_id = b.league_id and a.player_id != b.player_id) where a.league_id IN (16001,17001)  GROUP BY pa.name, pb.name" > reports/baby-private/gap-standings.csv
      ```

      - kart usage by player
      ```
      q -H -O -D "," -d "," "SELECT p.kart, COUNT(p.perf_id) as ct, SUM(CASE WHEN l.name = 'Jeran' THEN 1 ELSE 0 END) as Jeran, SUM(CASE WHEN l.name = 'JD' THEN 1 ELSE 0 END) as JD, SUM(CASE WHEN l.name = 'Nick' THEN 1 ELSE 0 END) as Nick, SUM(CASE WHEN l.name = 'Dan' THEN 1 ELSE 0 END) as Dan, SUM(CASE WHEN l.name = 'Tom' THEN 1 ELSE 0 END) as Tom, SUM(CASE WHEN l.name = 'Jesse' THEN 1 ELSE 0 END) as Guest FROM csv/perf.csv p JOIN csv/player.csv l ON (p.league_id = l.league_id and p.player_id = l.player_id) WHERE p.league_id IN (16001, 17001) group by p.kart order by ct desc" > reports/baby-private/kart-dist.csv
      ```

      - driver solo by player
      ```
      q -H -O -D "," -d "," "SELECT p.driver, COUNT(p.id) as ct, SUM(CASE WHEN p.player = 'Jeran' THEN 1 ELSE 0 END) as Jeran, SUM(CASE WHEN p.player = 'JD' THEN 1 ELSE 0 END) as JD, SUM(CASE WHEN p.player = 'Nick' THEN 1 ELSE 0 END) as Nick, SUM(CASE WHEN p.player = 'Dan' THEN 1 ELSE 0 END) as Dan, SUM(CASE WHEN p.player = 'Tom' THEN 1 ELSE 0 END) as Tom, SUM(CASE WHEN p.player = 'Jesse' THEN 1 ELSE 0 END) as Guest FROM csv/driver-perf.csv p WHERE p.league_id IN (16001, 17001) group by p.driver order by ct desc" > reports/baby-private/driver-dist.csv
      ```

      - driver duo by player
      ```
      q -H -O -D "," -d "," "SELECT d1, d2, COUNT(id) AS ct, SUM(CASE WHEN p.player = 'Jeran' THEN 1 ELSE 0 END) as Jeran, SUM(CASE WHEN p.player = 'JD' THEN 1 ELSE 0 END) as JD, SUM(CASE WHEN p.player = 'Nick' THEN 1 ELSE 0 END) as Nick, SUM(CASE WHEN p.player = 'Dan' THEN 1 ELSE 0 END) as Dan, SUM(CASE WHEN p.player = 'Tom' THEN 1 ELSE 0 END) as Tom, SUM(CASE WHEN p.player = 'Jesse' THEN 1 ELSE 0 END) as Guest FROM csv/drivers-perf.csv p WHERE p.league_id IN (16001, 17001) group by d1, d2 order by ct desc" > reports/baby-private/drivers-dist.csv
      ```

    - nick vs. tom all cup gp (league_id: 11001)
      - overall standings
      ```
      q -H -O -D "," -d "," "select p.name, COUNT(f.match_id) as races, SUM(CASE WHEN f.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN f.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN f.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN f.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(CASE WHEN f.finishPos = 5 THEN 1 ELSE 0 END) as f5, SUM(CASE WHEN f.finishPos = 6 THEN 1 ELSE 0 END) as f6, SUM(CASE WHEN f.finishPos = 7 THEN 1 ELSE 0 END) as f7, SUM(CASE WHEN f.finishPos = 8 THEN 1 ELSE 0 END) as f8, SUM(s.pts) as pts from csv/perf.csv f join csv/player.csv p join csv/score.csv s on (s.league_id = p.league_id and s.finishPos = f.finishPos and f.league_id = p.league_id and f.player_id = p.player_id) where p.league_id in (11001) group by p.name order by pts desc" > reports/nick-vs-tom/overall.csv
      ```

      - standings per course
      ```
      q -H -O -D "," -d "," "select m.course, p.name, COUNT(f.match_id) as races, SUM(CASE WHEN f.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN f.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN f.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN f.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(CASE WHEN f.finishPos = 5 THEN 1 ELSE 0 END) as f5, SUM(CASE WHEN f.finishPos = 6 THEN 1 ELSE 0 END) as f6, SUM(CASE WHEN f.finishPos = 7 THEN 1 ELSE 0 END) as f7, SUM(CASE WHEN f.finishPos = 8 THEN 1 ELSE 0 END) as f8, SUM(s.pts) as pts from csv/perf.csv f join csv/player.csv p join csv/score.csv s join csv/match.csv m on (m.match_id = f.match_id and m.cluster_id = f.cluster_id and m.league_id = f.league_id and s.league_id = p.league_id and s.finishPos = f.finishPos and f.league_id = p.league_id and f.player_id = p.player_id) where p.league_id in (11001) group by m.course, p.name order by course asc, pts desc" > reports/nick-vs-tom/by-course.csv
      ```
