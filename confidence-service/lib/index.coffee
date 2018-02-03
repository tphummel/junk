process.env.NODE_ENV ?= 'development'

{NODE_ENV, MASHAPE_SECRET} = process.env
isProd = NODE_ENV is 'production'

console.log 'NODE_ENV:', NODE_ENV
console.log 'MASHAPE_SECRET:', MASHAPE_SECRET

process.exit 1 if isProd and !MASHAPE_SECRET

port = process.env.PORT or '3000'

url         = require 'url'
restify     = require 'restify'
Confidence  = require 'confidence.js'
logger      = require './logger'
health      = require './health'

module.exports = server = restify.createServer
  name: 'confidence-service'
  version: '1.0.0'

server.use restify.bodyParser()
server.on 'after', logger

server.get '/', health
server.get '/health', health

server.post '/confidence', (req, res, next) ->
  variants = req.body

  if isProd and (req.headers['x-mashape-proxy-secret'] isnt MASHAPE_SECRET)
    msg = 'requests must be authorized by mashape.com'
    err = new restify.InvalidHeaderError msg
    return next err

  if !Array.isArray variants
    msg = 'POST body must be a json array of variants'
    err = new restify.InvalidArgumentError msg
    return next err

  if variants.length is 0
    msg = 'POST body must be an array of > 0 variants'
    err = new restify.InvalidArgumentError msg
    return next err

  aConf = new Confidence

  for variant in variants
    aConf.addVariant variant

  res.send 200, aConf.getResult()
  next()

server.listen port, ->
  console.log "#{server.name} listening on port #{port}"
