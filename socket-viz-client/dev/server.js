var http        = require("http"),
    path        = require("path"),
    fs          = require("fs"),
    url         = require("url"),
    io          = require("socket.io"),
    redis       = require("redis").createClient(),
    pubServer   = require("./pub");

var port = process.env.PORT || 7007;

var server = http.createServer(function(req, res){
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

io.listen(server).sockets.on("connection", function(socket) {
  redis.subscribe("tetris:performances");
  redis.on("message", function(channel, perf) {
    return socket.emit("performance", JSON.parse(perf));
  });
  return socket.on("received", function(data) {
    return console.log(JSON.stringify(data));
  });
});

pubServer();

console.log("dev server listening on port:", port);
