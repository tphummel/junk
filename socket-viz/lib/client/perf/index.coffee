template = require "./template.jade"
require "./style.scss"

cats = 
  hi: (prev, curr) -> curr > prev
  lo: (prev, curr) -> curr < prev

stats = 
  line: (p) -> p.lines
  time: (p) -> p.time
  rate: (p) -> (p.lines / p.time).toFixed 4

module.exports = Perf = (opts) ->
  {@el} = opts

  @marks = {}
  for cat in Object.keys(cats)
    @marks[cat] ?= {}
    for stat in Object.keys(stats)
      @marks[cat][stat] ?= ["--", null]

  @render()
  return this

Perf::clearHighlighting = -> 
  perfs = @el.querySelectorAll "td"
  for perf in perfs
    perf.style["background-color"] = "white"

Perf::updateHighlighting = (updates) -> 
  if updates.length > 0

    for up in updates
      sel = "tr.#{up[0]}.#{up[1]}"
      divs = @el.querySelector sel
      divs.style["background-color"] = "aquamarine"

Perf::render = (updates=[]) ->
  @clearHighlighting()

  opts = 
    marks: @marks

  @el.innerHTML = template opts

  @updateHighlighting updates

  return this

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

  @render updates