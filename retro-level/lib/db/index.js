var db, levelup, memdown, opts, schema, path, ts, sublevel;

path = require("path");
levelup = require("levelup");
sublevel = require("level-sublevel");
ts = require("level-timestamps");
schema = require("./schema");

db = null;

opts = {
  valueEncoding: "json"
};

switch (process.env.NODE_ENV) {
  case "test":
    memdown = require("memdown");
    opts.db = memdown;
    db = levelup("", opts);
    break;
  default:
    db = levelup(path.join(__dirname, "../..", "/data/level"), opts);
}

db = sublevel(db);

ts(db);

db = schema(db);

module.exports = db;