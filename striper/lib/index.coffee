process.env.NODE_ENV ?= 'development'
process.env.APP_HOST ?= "stagelincx.me"

if process.env.NODE_ENV is 'test'
  replay = require 'replay' 
  replay.mode = 'record'

require './server'