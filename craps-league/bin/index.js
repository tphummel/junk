'use strict';

function d6 () {
  return 1 + Math.floor(Math.random() * 6)
}

function tallyResults (history) {
  const resultsTemplate = {
    rollCount: 0,
    pointsSet: 0,
    pointsWon: 0,
    comeOutWins: 0,
    comeOutLosses: 0,
    netComeOutWins: 0,
    neutrals: 0
  }

  return history.reduce((memo, roll) => {
    memo.rollCount++

    switch (roll.result) {
      case 'neutral':
        memo.neutrals++;
        break;
      case 'point set':
        memo.pointsSet++;
        break;
      case 'point win':
        memo.pointsWon++;
        break;
      case 'comeout win':
        memo.comeOutWins++;
        memo.netComeOutWins++;
        break;
      case 'comeout loss':
        memo.comeOutLosses++;
        memo.netComeOutWins--;
        break;
    }

    return memo
  }, resultsTemplate)
}

function play () {
  let history = []

  let isComeOut = true
  let point
  while(true) {
    const dice = [d6(), d6()].sort()

    let roll = {
      die1: dice[0],
      die2: dice[1],
      sum: dice.reduce((m, r) => { return m + r }, 0)
    }

    // game logic based on: https://github.com/tphummel/dice-collector/blob/master/PyTom/Dice/logic.py

    if (isComeOut) {
      if ([2,3,12].indexOf(roll.sum) !== -1) {
        roll.result = 'comeout loss'
      } else if ([7,11].indexOf(roll.sum) !== -1 ) {
        roll.result = 'comeout win'
      } else {
        point = roll.sum
        roll.result = 'point set'
        isComeOut = false
      }
    } else {
      if (roll.sum === point) {
        roll.result = 'point win'
        isComeOut = true
      } else if (roll.sum === 7) {
        roll.result = 'seven out'
      } else {
        roll.result = 'neutral'
      }
    }

    history.push(roll)

    if (roll.result === 'seven out') break
  }
  return {
    rolls: history,
    summary: tallyResults(history)
  }
}

module.exports = play
