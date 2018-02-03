var http = require("http"),
    path = require("path"),
    fs   = require("fs"),
    url  = require("url");

var port = process.env.PORT || 7007;

http.createServer(function(req, res){
  var reqUrl = url.parse(req.url);

  console.log("request heard: ", new Date, reqUrl.pathname);

  if(reqUrl.pathname === "/"){
    res.writeHead(200, {"Content-Type": "text/html"});
    fs.createReadStream(path.join(__dirname,'../build/index.html')).pipe(res);

  }else if(reqUrl.pathname === "/main.js"){
    res.writeHead(200, {"Content-Type": "application/javascript"});
    fs.createReadStream(path.join(__dirname,'../build/main.js')).pipe(res);

  }else{
    res.writeHead(404, {"Content-Type": "text/plain"});
    res.write("file not found");
    res.end();
  }

}).listen(port);

console.log("dev server listening on port:", port);
