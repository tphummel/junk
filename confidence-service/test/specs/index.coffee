process.env.NODE_ENV = 'test'
process.env.PORT = 4444

test = require 'tape'
restify = require 'restify'

server = require '../../lib'

jsonClient = restify.createJsonClient
  url: 'http://localhost:4444'
  version: '*'

test '/health', (t) ->
  server = require '../../lib'

  jsonClient.get '/health', (err, req, res, obj) ->
    t.notOk err, 'no err'
    t.equal obj.status, 'OK', 'status OK'
    t.end()

test '/confidence', (t) ->

  payload = [
    {
      id: 'A',
      name: 'Alluring Alligators',
      conversionCount: 1500,
      eventCount: 3000
    },
    {
      id: 'B',
      name: 'Belligerent Bumblebees',
      conversionCount: 2500,
      eventCount: 3000
    }
  ]

  jsonClient.post '/confidence', payload, (err, req, res, obj) ->
    t.notOk err, 'no err'
    t.ok obj.hasWinner?, 'hasWinner defined'
    t.ok obj.hasEnoughData?, 'hasEnoughData defined'
    t.ok obj.confidenceInterval, 'confidenceInterval defined'
    t.ok obj.readable, 'has readable defined'
    t.end()

test 'cleanup', (t) ->
  jsonClient.close()
  server.close -> t.end()
