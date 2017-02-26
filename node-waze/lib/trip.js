(function(){
  var request = require('request'),
      jar = require('./jar'),
      xml2js = require('xml2js').parseString,
      opts;

  opts = {
    jar: jar
  };

  module.exports = {
    get: function(id, cb) {
      var baseUrl = 'https://www.waze.com/Descartes-live/app/Archive/Session?id=',
          url;

      url = baseUrl + id;

      request.get(url, opts, function(err, r, b){
        var obj, xml, json;

        if(err) return cb(err, null);

        try {
          obj = JSON.parse(b);
        }catch(e){
          return cb(e, null);
        }

        xml = obj.archiveSessions.objects[0].data
        xml2js(xml, {explicitArray: true}, function(err, json){
          var roads, outs;

          roads = json['wfs:FeatureCollection']['gml:featureMember'];

          outs = roads.map(function(road){
            return road['myns:roads'][0];
          });

          cb(err, outs);
        });


      });
    }
  };

})();
