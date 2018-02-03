var bowling = require('bowling')

exports.handler = function (event, context) {
  var playerGame
  try {
    playerGame = bowling(event)
    context.succeed(playerGame)
  }catch (err) {
    context.fail(err)
  }
}
