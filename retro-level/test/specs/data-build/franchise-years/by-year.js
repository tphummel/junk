var path = require("path");

test("franchise-years by-year", function(t) {

  var runFileList = require(path.join(__dirname, "../../../..", "data/build/runner")),
      db          = require(path.join(__dirname, "../../../..", "lib/db")),
      runList     = ["franchise-years.js"];

  t.plan(13);

  runFileList(runList, function(err) {
    t.notOk(err, "no err from runFileList");

    db.franchiseYears.byYear.createReadStream({start: "2010", limit:1})
      .on("data", function(data) {

        var valueFields = [
          "yearID", "lgID", "teamID", "franchID", 
          "name", "teamIDBR", "teamIDretro"
        ];

        valueFields.forEach(function(field){
          var msg = "data value should be truthy: "+field+", "+data.value[field];
          t.ok(data.value[field], msg);
        });

        t.ok(data.value, "data should have a sub-object 'value'");
        t.ok(data.key, "data should have a key set");
        t.ok(data.value.createdAt, "createdAt stamp should be set");
        t.ok(data.value.modifiedAt, "modifiedAt stamp should be set");

        var expectedKey = [data.value.franchID, data.value.yearID].join("!");
        t.equal(expectedKey, data.key, "key should match expected");
      })
      .on("error", function(err) {
        t.fail("createReadStream generated an error!");
      })
      .on("close", function(){
        console.log("close");
      })
      .on("end", function() {
        console.log("test end!");
        t.end()
      });
  });
});
