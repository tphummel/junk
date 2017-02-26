(function(){
  var request = require('request'),
      jar = require('./jar'),
      url = 'https://www.waze.com/Descartes-live/app/Archive/List?minDistance=1000&offset=0&count=',
      opts, getTrips;

  opts = {
    jar: jar
  };

  module.exports = {
    get: function(cb) {
      request.get(url, opts, function(err, r, b){

        obj = JSON.parse(b);
        trips = obj.archives.objects;
        cb(err, trips);
      });
    }
  };

})();
