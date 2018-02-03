{inherits} = require 'util'
{EventEmitter} = require 'events'

cats = 
  hi: (prev, curr) -> curr > prev
  lo: (prev, curr) -> curr < prev

stats = 
  line: (p) -> p.lines
  time: (p) -> p.time
  rate: (p) -> (p.lines / p.time).toFixed 4

Perf = -> 
  @marks = {}

  for cat in Object.keys cats
    @marks[cat] ?= {}
    for stat in Object.keys stats
      @marks[cat][stat] ?= ['--', null]

  return this

inherits Perf, EventEmitter

Perf::addPerf = (perf) ->
  self = this
  updates = []
  for cat, catFn of cats
    for stat, statFn of stats

      curr = statFn perf
      prev = self.marks[cat][stat]

      name = perf.name
      delta = curr-prev[1]

      unless delta % 1 is 0
        delta = delta.toFixed 4

      if !prev[1] or (catFn prev[1], curr)
        age = 0
        self.marks[cat][stat] = [name, curr, delta, age]
        updates.push [cat, stat]
      else
        self.marks[cat][stat][3] += 1

  @emit 'update', updates

module.exports = Perf
