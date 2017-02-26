fs        = require "fs"
assert    = require("chai").assert

parseEvent = require "../../lib/event"

eventTxt = fs.readFileSync "#{__dirname}/../fixtures/events2012.txt", "utf8"

describe "Game Log", ->
  beforeEach ->
    @sut = parseEvent eventTxt
    
  it "control", ->
    assert.isTrue true