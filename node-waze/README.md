## node-waze

fetch your commute data

[![Build Status](https://travis-ci.org/tphummel/node-waze.png)](https://travis-ci.org/tphummel/node-waze)
[![NPM](https://nodei.co/npm/waze.png?downloads=true)](https://nodei.co/npm/waze)

## install

    npm install waze

## usage

```javascript
var waze = require("waze");

var wazeLogin = {
  user_id: "myusername",
  password: "mypassword"
}

waze.createClient(wazeLogin, function(err, client) {

  client.trips.get(function(err, trips) {

    console.log("trip count: ", trips.length);

    var lastTrip = trips.shift();
    console.log("lastTrip: ", lastTrip);

    client.trip.get(lastTrip.id, function(err, trip){
      trip.forEach(function(segment){
        console.log("trip segment detail: ", segment);
      });
    });

  });
});
```

## test

    npm test

## example

    node example/top-speed.js

outputs:

    date       start    end      duration      name                                           meters kph
    2013-11-07 20:51:42 20:53:14 2 minutes     SR-90 W,Los Angeles                            2672   104
    2013-11-11 19:23:24 19:24:57 2 minutes     SR-90 W,Los Angeles                            2676   104
    2013-11-11 19:15:46 19:20:10 4 minutes     I-405 S,Los Angeles                            7618   104
    2013-11-07 20:51:03 20:51:18 a few seconds Exit 50B: Slauson Ave / Marina Fwy,Culver City 385    94
    2013-11-07 20:51:18 20:51:42 a few seconds to SR-90 W / Marina del Rey,Culver City        558    84
    2013-11-07 20:42:13 20:48:00 6 minutes     I-405 S,Los Angeles                            7958   83
    2013-11-05 17:19:05 17:19:10 a few seconds Sunset Blvd,West Hollywood                     116    79
    2013-11-11 19:22:55 19:23:24 a few seconds to SR-90 W / Marina del Rey,Culver City        564    71
    2013-11-11 19:21:17 19:22:34 a minute      I-405 S,Culver City                            1478   69

Note: I'm using [node-replay](https://npmjs.org/package/replay) so you can run this script without needing your own account or drive data. To run it for yourself, edit the login info in `top-speed.js`. And either run with `REPLAY=bloody node example/top-speed.js` or comment the `require`.
