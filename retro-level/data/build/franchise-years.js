var path = require("path"),
    db = require(path.join(__dirname, "../..", "lib/db"));

module.exports = {
  subLevel: "franchiseYears",
  dataFile: "lahman/Teams.csv",
  idField: function (row){
    return [row.franchID, row.yearID].join("!");
  }
}