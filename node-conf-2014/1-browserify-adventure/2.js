var uniq = require('uniq');

var str = prompt();
var items = str.split(',');

var uniqItems = uniq(items);

console.log(uniqItems);
