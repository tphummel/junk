var uniq = require('uniq');

module.exports = function(str){
  var items = str.split(',');
  return uniq(items);
}
