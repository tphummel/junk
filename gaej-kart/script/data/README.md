# mario kart: double dash!! data

## helper tables

NOTE: converted league winPointValues to a new lookup table for ease
```
league_id	winPointValues
11001	[10L, 8L, 6L, 4L, 3L, 2L, 1L, 0L]
16001	[4L, 3L, 2L, 1L]
17001	[4L, 3L, 2L, 1L]
18001	[4L, 3L, 2L, 1L]
19001	[10L, 8L, 6L, 4L, 3L, 2L, 1L, 0L]
20001	[2L, 1L]
```
saved in: `csv/score.csv`

also:

`make-driver-perf.sh` -> csv/driver-perf.csv

`make-drivers-perf.sh` -> csv/driver-perf.csv

# schemas

```
head -n 2 csv/*.csv
==> csv/cluster.csv <==
startDate,venue_id,seq,league_id,season_id,cluster_id,activeFlag
2010-09-09T08:54:52,1001,1,11001,1,4001,False

==> csv/league.csv <==
specifications,name,lapsPerRace,league_id,winPointValues,numberOfTotalRacers,engineClass,courses,racesPerCluster,numberOfPlayers,owner,password,itemsSetting,users
"gentlemen's rules character selection. All Cup 16 races to a cluster. Reco items, reco laps, 150cc. Game dictates course order",2P GP All Cup Official,0,11001,"[10L, 8L, 6L, 4L, 3L, 2L, 1L, 0L]",8,150cc,"[u'Luigi Circuit', u'Peach Beach', u'Baby Park', u'Dry Dry Desert', u'Mushroom Bridge', u'Mario Circuit', u'Daisy Cruiser', u'Waluigi Stadium', u'Sherbet Land', u'Mushroom City', u'Yoshi Circuit', u'DK Mountain', u'Wario Colosseum', u'Dino Dino Jungle', u'Bowser Castle', u'Rainbow Road']",16,2,tphummel,dowork,recommended,"[users.User(email='nickspirkin12@gmail.com',_user_id='103689850624126405982')]"

==> csv/match.csv <==
match_id,seq,league_id,notes,submitDate,season_id,course,cluster_id
1002,14,11001,,2010-09-09T09:52:46,1,DK Mountain,4001

==> csv/perf.csv <==
match_id,kart,league_id,drivers,finishPos,season_id,perf_id,player_id,cluster_id
1002,Toadette Kart,11001,"[u'Paratroopa', u'Baby Mario']",2,1,31001,2001,4001

==> csv/player.csv <==
league_id,player_id,name
11001,2001,Nick

==> csv/score.csv <==
league_id,pos,pts
11001,1,10

==> csv/season.csv <==
league_id,season_id,name,seq
11001,1,2010-11,1

==> csv/venue.csv <==
league_id,venue_id,name
11001,1001,Nick's Apt
```

## general expository queries (assumes pwd = data/csv/)
```
q -H -O -T -d "," "select * from csv/league.csv where league_id = 16001"
,4pofficialbaby,9,16001,"[4L, 3L, 2L, 1L]",4,150cc,[u'Baby Park'],50,4,tphummel,dowork,frantic,
```

```
q -H -O -T -d "," "select * from csv/venue.csv where league_id = 16001"
16001,1001,2096 arrow rte
16001,80001,14211 dickens
16001,94001,12015 lamanda
16001,113001,13911 old harbor
```

```
q -H -O -T -d "," "select * from csv/player.csv where league_id = 16001"
16001,1001,2096 arrow rte
16001,80001,14211 dickens
16001,94001,12015 lamanda
16001,113001,13911 old harbor
```

```
q -H -O -T -d "," "select * from csv/season.csv where league_id = 16001"
16001,1,2010-11,1
16001,103001,2012-13,2
16001,114001,,3
16001,115001,2013,4
```

### season clusters for a league
```
-- leagueName, seq, clusterdate, venueName

q -H -O -T -d "," "select s.name as season, c.seq, c.startDate, v.name as venue from csv/season.csv s join csv/cluster.csv c join csv/venue.csv v on (s.season_id = c.season_id and s.league_id = c.league_id and v.league_id = s.league_id and v.venue_id = c.venue_id) where s.league_id = 16001 order by s.name asc, c.seq asc"
```

### cluster matches for all leagues
```
q -H -O -T -d "," "select l.name, l.itemsSetting, c.startDate, m.submitDate, m.seq, m.course from csv/cluster.csv c join csv/match.csv m join csv/league.csv l on (c.season_id = m.season_id and c.league_id = m.league_id and c.cluster_id = m.cluster_id and l.league_id = c.league_id and l.league_id = m.league_id)"
```

### cluster matches for a single league
```
q -H -O -T -d "," "select l.name, l.itemsSetting, c.startDate, m.submitDate, m.seq, m.course from csv/cluster.csv c join csv/match.csv m join csv/league.csv l on (c.season_id = m.season_id and c.league_id = m.league_id and c.cluster_id = m.cluster_id and l.league_id = c.league_id and l.league_id = m.league_id) where c.league_id = 16001"
```

### standings based on league rules

combined 4p baby frantic = `p.league_id in (16001, 17001)`

```
q -H -O -T -d "," "select p.name, COUNT(f.match_id) as races, SUM(CASE WHEN f.finishPos = 1 THEN 1 ELSE 0 END) as f1, SUM(CASE WHEN f.finishPos = 2 THEN 1 ELSE 0 END) as f2, SUM(CASE WHEN f.finishPos = 3 THEN 1 ELSE 0 END) as f3, SUM(CASE WHEN f.finishPos = 4 THEN 1 ELSE 0 END) as f4, SUM(s.pts) as pts, ROUND(SUM(s.pts)*1.0/COUNT(f.match_id),4) as ppr from csv/perf.csv f join csv/player.csv p join csv/score.csv s on (s.league_id = p.league_id and s.finishPos = f.finishPos and f.league_id = p.league_id and f.player_id = p.player_id) where p.league_id in (16001, 17001) group by p.name order by ppr desc"
```

### enhanced race log

```
q -H -O -T -d "," "SELECT   m.league_id ||'_' ||m.cluster_id ||'_' ||m.seq AS id, m.submitdate, p1.name    AS p1n, f1.kart    AS p1k, f1.driver1 AS p1d1, f1.driver2 AS p1d2, p2.name    AS p2n, f2.kart    AS p2k, f2.driver1 AS p2d1, f2.driver2 AS p2d2, p3.name    AS p3n, f3.kart    AS p3k, f3.driver1 AS p3d1, f3.driver2 AS p3d2, p4.name    AS p4n, f4.kart    AS p4k, f4.driver1 AS p4d1, f4.driver2 AS p4d2 FROM     csv/MATCH.csv m JOIN     csv/perf.csv f1 JOIN     csv/player.csv p1 JOIN     csv/perf.csv f2 JOIN     csv/player.csv p2 JOIN     csv/perf.csv f3 JOIN     csv/player.csv p3 JOIN     csv/perf.csv f4 JOIN     csv/player.csv p4 ON       ( f1.finishpos = 1 AND      f1.match_id = m.match_id AND      f1.league_id = m.league_id AND      p1.league_id = f1.league_id AND      p1.player_id = f1.player_id AND         f2.finishpos = 2 AND      f2.match_id = m.match_id AND      f2.league_id = m.league_id AND      p2.league_id = f2.league_id AND      p2.player_id = f2.player_id AND         f3.finishpos = 3 AND      f3.match_id = m.match_id AND      f3.league_id = m.league_id AND      p3.league_id = f3.league_id AND      p3.player_id = f3.player_id AND         f4.finishpos = 4 AND      f4.match_id = m.match_id AND      f4.league_id = m.league_id AND      p4.league_id = f4.league_id AND      p4.player_id = f4.player_id ) WHERE    m.league_id IN (17001) ORDER BY m.submitdate LIMIT 5"
```
