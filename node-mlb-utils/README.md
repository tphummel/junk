node-mlb-utils
==============
utilities for working with the mlb player data from [daily baseball data]

Setup
-----
    
    git clone git@github.com:tphummel/node-mlb-utils.git
    cd node-mlb-utils
    npm install
    mkdir -p ./data/2012/
    cd !$
    mkdir html csv sql
    cd ../..

Create SQL
----------

    coffee get_html.coffee
    coffee html_to_csv.coffee
    coffee csv_to_sql.coffee

Load into PostgreSQL
--------------------

    pgsql -h localhost --d mlb -p 5432 -U user 
    \i /path/to/repo/ddl/bat_gm.sql
    \i /path/to/repo/ddl/pit_gm.sql
    \i /path/to/repo/ddl/helper_funcs.sql
    \i /path/to/repo/data/2012/sql/pit_gm.sql
    \i /path/to/repo/data/2012/sql/bat_gm.sql
    

Have fun!
--------------------
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


results in: 

    
    Highest BABIP, MLB 2012 (thru 9/15/2012) Min. 300 AB
    
               nm           |      babip       
    ------------------------+------------------
     Fowler, Dexter         | .396 (120 / 303)
     McCutchen, Andrew      | .390 (152 / 390)
     Votto, Joey            | .389 (95 / 244)
     Trout, Mike            | .384 (139 / 362)
     To, Hunter,            | .380 (132 / 347)
     Cabrera, Melky         | .379 (148 / 390)
     Jackson, Austin        | .376 (128 / 340)
     Montero, Miguel        | .364 (111 / 305)
     Posey, Buster          | .363 (137 / 377)
     Mauer, Joe             | .363 (146 / 402)
     Bloomquist, Willie     | .362 (98 / 271)
     Jay, Jon               | .358 (111 / 310)
     Wright, David          | .357 (144 / 403)
     Gonzalez, Carlos       | .355 (134 / 377)
     Colvin, Tyler          | .355 (88 / 248)
     Kemp, Matt             | .354 (84 / 237)
     Jeter, Derek           | .352 (183 / 520)
     Gordon, Alex           | .351 (159 / 453)



    

  [daily baseball data]: http://dailybaseballdata.com/cgi-bin/getstats.pl