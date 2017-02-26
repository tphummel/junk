exports.parse = function(str){
  var items = str.split('\n');
  var outs = items.map(function(item){
    return JSON.parse(item);
  });
  return outs;
}

exports.stringify = function(rows){
  var strings = rows.map(function(row){
    return JSON.stringify(row);
  });
  return strings.join('\n');
}
