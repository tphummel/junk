(function(){
  var test = require("tape"),
      login = require("../lib/login"),
      trips = require("../lib/trips");

  test("trips", function(t){
    t.plan(6);

    trips.get(function(err, trips) {
      t.notOk(err, "err should be falsy");
      var obj, trip, fields;

      trip = trips[0];

      fields = [
        "id", 
        "userID", 
        "existingRoadMeters", 
        "startTime", 
        "endTime"
      ];

      fields.forEach(function(field){
        t.ok(trip[field], field+" should be set");
      });
      
      t.end();
    });
  });
})();