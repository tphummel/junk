var hq;

hq = require('hyperquest');

module.exports = function(url, data, cb) {
  var body, buffer, opts, ws;

  body = JSON.stringify(data);

  opts = {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length
    }
  };

  ws = hq.put(url, opts);
  ws.end(body);

  buffer = '';
  ws.on('data', function(chunk) {
    return buffer += chunk;
  });

  ws.on('error', function(err) {
    return cb(err);
  });

  return ws.on('end', function() {
    var res = ws.response;
    if (res.statusCode >= 400) {
      return cb(new Error('Bad statusCode in response: '+ res.statusCode), res);
    }
    res.body = buffer;
    return cb(null, res);
  });
};
