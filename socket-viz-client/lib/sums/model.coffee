{inherits} = require 'util'
{EventEmitter} = require 'events'

primary =
  games: (p) -> 1
  lines: (p) -> p.lines
  time: (p) -> p.time
  wins: (p) -> if p.wrank is 1 then 1 else 0
  sGames: (p) -> if p.lines/p.time >= 1 then 1 else 0

secondary =
  ratio: (sum) -> (sum.lines / sum.time).toFixed 4
  winPct: (sum) -> ((sum.wins+1) / (sum.games+2)).toFixed 4
  sPct: (sum) -> (sum.sGames / sum.games).toFixed 4

Sums = ->
  EventEmitter.call this
  @sums = {}
  return this

inherits Sums, EventEmitter

Sums::addPerf = (perf) ->
  @sums[perf.name] ?= {}

  for statName, fn of primary
    @sums[perf.name][statName] ?= 0
    @sums[perf.name][statName] += fn perf

  for statName, fn of secondary
    @sums[perf.name][statName] ?= 0
    @sums[perf.name][statName] = fn @sums[perf.name]

  @emit 'update'
  return true

Sums::getTitles = ->
  # TODO: no object.keys
  pri = Object.keys primary
  sec = Object.keys secondary

  titles = pri.concat sec
  titles.unshift 'name'

  return titles

module.exports = Sums
