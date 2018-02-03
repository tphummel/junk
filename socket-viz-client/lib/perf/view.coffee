require "./style.scss"

template  = require "./template.jade"
Model     = require "./model.coffee"

View = (opts) ->
  @el = document.createElement "div"
  
  @model = new Model()
  @model.on "update", (updates) => @render updates
  return this

View::addPerf = (perf) -> @model.addPerf perf

View::clearHighlighting = -> 
  perfs = @el.querySelectorAll "td"
  for perf in perfs
    perf.style["background-color"] = "white"

View::updateHighlighting = (updates) -> 
  if updates.length > 0

    for up in updates
      sel = "tr.#{up[0]}.#{up[1]}"
      divs = @el.querySelector sel
      divs.style["background-color"] = "aquamarine"

View::render = (updates=[]) ->
  @clearHighlighting()

  @el.innerHTML = template marks: @model.marks

  @updateHighlighting updates

  return this

module.exports = View
