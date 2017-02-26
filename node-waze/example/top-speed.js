var waze = require('../index'),
    async = require('async'),
    replay = require('replay'),
    moment = require('moment'),
    cliff = require('cliff');

replay.fixtures = __dirname+'/fixtures';

var wazeLogin = {
  user_id: 'tphummel',
  password: 'testpass'
}

waze.createClient(wazeLogin, function(err, client) {

  var topSpeed = {};

  client.trips.get(function(err, trips) {
    async.map(trips, function(trip, cb) {

      client.trip.get(trip.id, function(err, segments){
        segSpeeds = segments.map(function(seg) {
          var speed = {
            seq: seg['myns:id'][0],
            tripStart: trip.startTime,
            tripEnd: trip.endTime,
            segStart: seg['myns:start_time'][0],
            segEnd: seg['myns:end_time'][0],
            length: seg['myns:length'][0],
            speed: seg['myns:speed'][0],
            name: seg['myns:name'][0]
          };
          return speed;
        });

        cb(err, segSpeeds);

      });
    }, function(err, result){
      var flat = [],
          sorted, fields;

      result.forEach(function(arr) {
        arr.forEach(function(seq) {

          flat.push(seq);
        });
      });

      flat = flat.map(function(obj){
        var tsFmt = 'HH:mm:ss',
            dateFmt = 'YYYY-MM-DD';

        obj.date = moment(obj.tripStart).format(dateFmt);
        obj.tripStart = moment(obj.tripStart).format(tsFmt);
        obj.tripEnd = moment(obj.tripEnd).format(tsFmt);
        obj.start = moment.utc([obj.date, obj.segStart].join(' '));
        obj.end = moment.utc([obj.date, obj.segEnd].join(' '));

        obj.duration = moment.duration(obj.end.diff(obj.start)).humanize();
        obj.start = obj.start.local().format(tsFmt);
        obj.end = obj.end.local().format(tsFmt);

        obj.kph = obj.speed;
        obj.meters = obj.length;

        return obj;
      });


      sorted = flat.sort(function(a, b) {
        return parseInt(b.speed, 10) - parseInt(a.speed, 10);
      });

      fields = [
        'date', //'seq',
        'start', 'end', 'duration',
        'name', 'meters', 'kph'
      ];

      top = sorted.slice(0, 9);
      console.log(cliff.stringifyObjectRows(top, fields));
    });

  });
});
