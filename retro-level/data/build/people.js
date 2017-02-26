module.exports = {
  subLevel: "people",
  dataFile: "lahman/Master.csv",
  idField: "franchID",
  transform: function (row) {
    return row;
  }
}