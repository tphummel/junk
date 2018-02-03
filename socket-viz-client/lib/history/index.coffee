require "./style.scss"
template = require "./template.jade"

module.exports = History = (opts) ->
  {@el, @lastX} = opts

  @matchCount = 0
  
  @render()
  @matches = []

  return this

History::render = ->
  @el.innerHTML = template {matches: @matches}
  return this

History::getMatch = (matchId) ->
  found = null
  @matches.some (match) ->
    if match.matchId is matchid
      found = match
      return true

  return found

History::setMatch = (match) ->
  found = false
  for matObj, i in @matches
    if match.matchId is matObj.matchId
      @matches[i] = match
      found = true
  unless found
    @matches.push match
    @matchCount += 1
  return

History::addPerf = (perf) ->
  match = @findMatch perf.matchId
  match = @initMatch perf.matchId unless match
  match.push perf


  @render()

History::pushPerf = (perf)

History::trimAndSort = ->
  sortedMids = (Object.keys @matches).sort (a,b) ->
    if a > b then 1 else if a < b then -1 else 0

  trimMids = sortedMids.splice 0, @lastX

  matches = trimMids.map (mid) -> 
    match = @matches[mid]
    match.matchId = mid
    match

  @matches = {}

  for match in matches
    @matches[match.mid] = match
