var createSchema, createIndices, sublevel, secondary;

secondary = require("level-secondary");

createSchema = function(db) {
  var schema = {
    main: db,
    franchises: db.sublevel("franchises"),
    franchiseYears: db.sublevel("franchiseYears")
  };

  return schema;
};

createIndices = function(db) {
  byYear = secondary(db.franchiseYears, "yearFranchises", function(fy){
    return [fy.yearID, fy.franchID].join("!");
  });
  db.franchiseYears.byYear = byYear;
  return db;
}

module.exports = function(db) {
  var schema = createSchema(db);
  schema = createIndices(schema);
  return schema;
}