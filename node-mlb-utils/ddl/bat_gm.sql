DROP SEQUENCE IF EXISTS bat_gm_id CASCADE;
CREATE SEQUENCE bat_gm_id START 1;

DROP TABLE IF EXISTS bat_gm;
CREATE TABLE bat_gm (
    id          int PRIMARY KEY DEFAULT nextval('bat_gm_id'),
    mlb_id      int,
    season      int,
    name        varchar(200),
    team        varchar(10),
    vs_opp      varchar(10),
    result      varchar(10),
    date        date,  
    dh_seq      int,
    pos         varchar(20),
    gs          int DEFAULT 0,
    ab          int DEFAULT 0 ,
    h           int DEFAULT 0,
    doubles     int DEFAULT 0,
    triples     int DEFAULT 0,
    hr          int DEFAULT 0,
    r           int DEFAULT 0,
    rbi         int DEFAULT 0,
    bb          int DEFAULT 0,
    ibb         int DEFAULT 0,
    hbp         int DEFAULT 0, 
    so          int DEFAULT 0,
    sb          int DEFAULT 0,
    cs          int DEFAULT 0,
    picked_off  int DEFAULT 0,
    sh          int DEFAULT 0,
    sf          int DEFAULT 0, 
    e           int DEFAULT 0,
    pb          int DEFAULT 0,
    lob         int DEFAULT 0,
    gidp        int DEFAULT 0,
    created_at  timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (mlb_id, date, dh_seq)
);