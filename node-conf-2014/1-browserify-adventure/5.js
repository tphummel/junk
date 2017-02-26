var url = require('url');
var path = require('path');
var qs = require('querystring');
var input = prompt();

var p = url.parse(input, true);

var dirPath = path.dirname(p.pathname);

var relFilePath = p.query.file;
var resPath = url.resolve(input, relFilePath);

console.log(resPath);
