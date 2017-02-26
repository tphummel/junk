var login = require('./lib/login'),
    jar = require('./lib/jar'),
    trips = require('./lib/trips'),
    trip = require('./lib/trip');

module.exports = {
  createClient: function (opts, cb) {
    opts = opts != null ? opts : {};

    var client = {
      trip: trip,
      trips: trips
    };

    if (jar.cookies._csrf_token == null) {
      login(opts, function(err) {
        cb(err, client);
      });
    }else{
      cb(null, client);
    }
  }
};
