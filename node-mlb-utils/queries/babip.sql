SELECT MAX(name)                        AS nm,
       RATIO_FMT(CAST(COALESCE(SUM(h), 0) - COALESCE(SUM(hr), 0) AS INTEGER), (
       CAST(
       COALESCE(SUM(ab), 0) - COALESCE(SUM(so), 0) - COALESCE(SUM(hr), 0) +
       COALESCE(
       SUM
       (sf), 0) AS INTEGER) ), 3, TRUE) AS babip
FROM   bat_gm
WHERE  season = 2012
GROUP  BY mlb_id
HAVING SUM(ab) >= 300
ORDER  BY ( CAST(COALESCE(SUM(h), 0) - COALESCE(SUM(hr), 0) AS NUMERIC) ) / (
                    COALESCE(SUM(ab), 0) - COALESCE(SUM(so), 0) -
                    COALESCE(SUM(hr), 0) +
                    COALESCE(
                    SUM
                    (sf)
                    , 0) ) DESC;