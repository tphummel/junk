var jsonist = require('jsonist'),
    path = require('path'),
    url = require('url');

function makeUrl(pathname) {
  return url.format({
    protocol: 'https',
    hostname: 'api.numerousapp.com',
    pathname: pathname
  })
};

function Numerous(authToken){
  if (!(this instanceof Numerous))
    return new Numerous(authToken)

  if(!authToken)
    throw new Error('authToken parameter is required')

  this._authToken = authToken
};

Object.defineProperty(Numerous.prototype, "events",
  { get: function(metricId, cb){
      var url = makeUrl(path.join());
      cb(null, null);
    }
  , post: function(metricId, body, cb){
      console.log('this: ', this)
      var url = makeUrl(path.join('v1/metrics', metricId, 'events'))

      console.log(url)

      var opts = {
        headers: {
          'Authorization': 'Basic '+this._authToken
        }
      }

      console.log(body)

      jsonist.post(url, body, opts, cb)
    }
  });

module.exports = Numerous;

// module.exports = {
//   metrics: {},
//   event: {
//     get: function(){}
//     delete: function(){}
//   }
//   events: {
//     get: function(){}
//     post: function(opts, cb){
//       var path, url, urlOpts;
//       urlPath = path.join(
//         'v1',
//         'metrics',
//         opts.metricId,
//         'events'
//       );

//       urlOpts = {
//         headers: {
//           'Content-Type': 'application/json',
//           'Auth':
//         }
//       };
//       url = makeUrl(path);

//       jsonist.post(url, opts, cb);
//     }
//   },
//   interactions: {},
//   stream: {},
//   users: {}
// }
