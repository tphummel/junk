(function(){
  var test = require("tape"),
      login = require("../lib/login"),
      trip = require("../lib/trip");

  test("trip", function(t){
    t.plan(14);

    var sampleId = "721320672";
    
    trip.get(sampleId, function(err, trip) {
      t.notOk(err, "err should be falsy");
      var obj, trip, segment, fields;

      t.ok(Array.isArray(trip), "trip should be an array");

      segment = trip[1];

      t.ok(segment.$.fid, "fid");
      t.ok(segment["gml:boundedBy"][0]["gml:Box"], "bounding box");
      t.ok(segment["myns:msGeometry"][0]["gml:LineString"], "segment line");
      t.ok(segment["myns:dbSegments"][0]["myns:seg"], "some segment detail");

      fields = [
        "id", "status", "info", 
        "start_time", "end_time", 
        "length", "speed", "name"
      ];

      fields.forEach(function(field) {
        t.ok(segment["myns:"+field][0], field+" should be set");
      });
      
      t.end();
    });
  });
})();