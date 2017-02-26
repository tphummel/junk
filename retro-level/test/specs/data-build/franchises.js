test = require("tape"),
path = require("path");

test("franchises", function(t) {

  var runFileList = require(path.join(__dirname, "../../..", "data/build/runner")),
      db          = require(path.join(__dirname, "../../..", "lib/db")),
      conf        = ["franchises.js"];

  t.plan(6);

  runFileList(conf, function(err) {
    if(err) console.log("err1: ", err);
    t.notOk(err, "loading franchises data should not return an error");

    db.franchises.createReadStream({limit:1})
      .on("data", function(data) {
        t.ok(data.value, "data should have a sub-object 'value'");
        t.ok(data.key, "data should have a key set");
        t.ok(data.value.createdAt, "createdAt stamp should be set");
        t.ok(data.value.modifiedAt, "modifiedAt stamp should be set");
        t.equal(data.value.franchID, data.key, "key should equal value.franchID");
      })
      .on("error", function(err) {
        t.fail("createReadStream generated an error!");
      })
      .on("end", function() {
        t.end()
      });
  });
});