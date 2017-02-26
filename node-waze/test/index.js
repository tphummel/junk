(function(){
  var replay = require("replay"),
      test = require("tape"),
      lib = require("../index"),
      testLogin = {
        user_id: "tphummel", 
        password: "testpassword"
      };

  replay.fixtures = __dirname+"/fixtures";

  test("package", function(t){
    t.test("get trips", function(st) {
      var client = lib.createClient(testLogin, function(err, client) {
        client.trips.get(function(err, trips) {
          st.notOk(err, "no err from trips.get");
          st.ok(trips, "trips.get returns a truthy thing");
          st.end();
        });
      });
    });

    t.test("get trip", function(st) {
      var client = lib.createClient(testLogin, function(err, client) {

        var validId = "721320672";
        client.trip.get(validId, function(err, trip) {
          st.notOk(err, "no err from trip.get");
          st.ok(trip, "trip.get returns a truthy thing");
          st.end();
        });
      });
    });

  });

  require("./login.js");
  require("./trips.js");
  require("./trip.js");

})();
