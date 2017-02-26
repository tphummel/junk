_ = require "underscore"

module.exports = (csvText) ->
  rawValues = csvText.split ","
  finalValues = _.map rawValues, (val) -> val.replace /\"/g, ""