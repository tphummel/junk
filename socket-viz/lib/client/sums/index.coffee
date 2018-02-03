require "./style.scss"
template = require "./template.jade"

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

module.exports = Sums = (opts) ->
  {@el} = opts

  @sums = {}

  @render()
  return this

Sums::render = ->
  pri = Object.keys primary
  sec = Object.keys secondary
  titles = pri.concat sec

  titles.unshift "name"
  
  opts = 
    titles: titles
    sums: @sums

  @el.innerHTML = template opts

  return this

Sums::addPerf = (perf) ->

  @sums[perf.name] ?= {}

  for name, fn of primary
    @sums[perf.name][name] ?= 0
    @sums[perf.name][name] += fn perf

  for name, fn of secondary
    @sums[perf.name][name] ?= 0
    @sums[perf.name][name] = fn @sums[perf.name]

  @render()