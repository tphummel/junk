let play = require('./index')

let game = {
  date: (new Date()).toISOString(),
  awayTeam: {
    name: process.argv[2],
    perf: play()
  },
  homeTeam: {
    name: process.argv[3],
    perf: play()
  },
  seasons: ["2019"],
  game_type: "regular"
}

if (game.awayTeam.perf.summary.pointsWon > game.homeTeam.perf.summary.pointsWon) {
  game.awayTeam.result = "win"
  game.homeTeam.result = "loss"
} else if (game.awayTeam.perf.summary.pointsWon < game.homeTeam.perf.summary.pointsWon) {
  game.awayTeam.result = "loss"
  game.homeTeam.result = "win"
} else {
  if (game.awayTeam.perf.summary.netComeOutWins > game.homeTeam.perf.summary.netComeOutWins) {
    game.awayTeam.result = "win"
    game.homeTeam.result = "loss"
  } else if (game.awayTeam.perf.summary.netComeOutWins < game.homeTeam.perf.summary.netComeOutWins) {
    game.awayTeam.result = "loss"
    game.homeTeam.result = "win"
  } else {
    if (game.awayTeam.perf.summary.rollCount > game.homeTeam.perf.summary.rollCount) {
      game.awayTeam.result = "win"
      game.homeTeam.result = "loss"
    } else if (game.awayTeam.perf.summary.rollCount < game.homeTeam.perf.summary.rollCount) {
      game.awayTeam.result = "loss"
      game.homeTeam.result = "win"
    }
  }
}

// // node bin/game.js team1 team2
// console.table(game.awayTeam.perf.summary)
// console.log(game.awayTeam.result, game.awayTeam.perf.summary.pointsWon, game.awayTeam.perf.summary.netComeOutWins, game.awayTeam.perf.summary.rollCount)
// console.table(game.homeTeam.perf.summary)
// console.log(game.homeTeam.result, game.homeTeam.perf.summary.pointsWon, game.homeTeam.perf.summary.netComeOutWins, game.homeTeam.perf.summary.rollCount)

// node bin/game.js team1 team2 | yq r -
console.log(JSON.stringify(game))
