process.env.NODE_ENV ?= "development"

express   = require "express"
health    = require 'connect-health-check'

file      = "../../config/#{process.env.NODE_ENV}.json"
config    = require file
console.log "config: ", config
redis     = require("redis").createClient config.port, config.host

app       = express()
server    = require("http").createServer app
io        = require("socket.io").listen server

bundle = require './bundle'

app.configure ->
  app.use health
  app.use express.static './public', 
    {maxAge: 86400000}
  app.use express.logger 'dev'

app.set 'views', 'lib/client/views'
app.set 'view engine', 'jade'

app.get '/', (req, res) -> 
  res.render 'index.jade'

io.sockets.on "connection", (socket) ->

  redis.subscribe "tetris:performances"
  redis.on "message", (channel, perf) ->
    socket.emit "performance", JSON.parse perf

  socket.on "received", (data) ->
    console.log (JSON.stringify data)


port = process.env.PORT or 3000
server.listen port
console.log "Express running on port #{port}"