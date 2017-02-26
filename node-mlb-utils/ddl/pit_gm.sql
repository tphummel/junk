DROP SEQUENCE IF EXISTS pit_gm_id CASCADE;
CREATE SEQUENCE pit_gm_id START 1;

DROP TABLE IF EXISTS pit_gm;
CREATE TABLE pit_gm (
    id              int PRIMARY KEY DEFAULT nextval('pit_gm_id'),
    mlb_id          int,
    season          int,
    name            varchar(200),
    team            varchar(10),
    vs_opp          varchar(10),
    result          varchar(10),
    date            date,  
    dh_seq          int,
    pos             varchar(20),
    gs              int DEFAULT 0,
    outs            int DEFAULT 0,
    h               int DEFAULT 0,
    r               int DEFAULT 0,
    er              int DEFAULT 0,
    bb              int DEFAULT 0,
    ibb             int DEFAULT 0,
    k               int DEFAULT 0,
    hb              int DEFAULT 0,
    pickoffs        int DEFAULT 0,
    hr              int DEFAULT 0,
    wp              int DEFAULT 0, 
    w               int DEFAULT 0,
    l               int DEFAULT 0,
    sv              int DEFAULT 0,
    bs              int DEFAULT 0,
    hld             int DEFAULT 0,
    cg              int DEFAULT 0,
    created_at      timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (mlb_id, date, dh_seq)
);