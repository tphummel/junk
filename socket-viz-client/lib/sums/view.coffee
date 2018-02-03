require "./style.scss"
template = require "./template.jade"
Model = require "./model.coffee"

View = (opts) ->
  @el = document.createElement "div"
  @model = new Model()

  @model.on "update", @render.bind this

  return this

View::addPerf = (perf) -> @model.addPerf perf

View::render = ->

  opts =
    titles: @model.getTitles()
    sums: @model.sums

  @el.innerHTML = template opts

  return this

module.exports = View
