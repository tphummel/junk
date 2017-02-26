(function(){
  var request = require('request'),
      jar = require('./jar'),
      url = 'https://www.waze.com/login/create',
      csrfUrl = 'https://www.waze.com/login/get',
      login;

  module.exports = login = function(opts, cb) {
    var reqOpts = {
      form: {
        user_id: opts.user_id,
        password: opts.password
      },
      jar: jar
    };

    request.get(csrfUrl, reqOpts, function(e){
      if(e) return cb(e);

      jar.cookies.forEach(function(cookie){
        if(cookie.name === '_csrf_token'){
          reqOpts.headers = {
            'X-CSRF-Token': cookie.value
          };
        }
      });

      request.post(url, reqOpts, cb);
    });

  }

})();
