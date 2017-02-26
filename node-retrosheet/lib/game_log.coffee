fieldMappings     = require "./field_maps/game_log"
csvToStringArray  = require "./helpers/csv"

parseGameLog = (csvText) ->
  result = {}
  
  values = csvToStringArray csvText
  
  for spec, i in fieldMappings
    raw = values[i] or null
    result[spec.property] = if spec.fn then spec.fn raw else raw
  
  return result

module.exports = parseGameLog