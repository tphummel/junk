(function(){
  var request = require('request'),
      jar;

  if (!jar) {
    jar = request.jar();
  }

  module.exports = jar;
})();
