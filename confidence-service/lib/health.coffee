pkg = require '../package.json'

module.exports = (req, res, next) ->
  res.send 200,
    status: 'OK'
    ts: req._time
    service: pkg.name
    package: pkg.version

  next()
