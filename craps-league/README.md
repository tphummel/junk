# craps toy/simulator

## simulate a single performance

```
➜  node bin/single.js
┌─────────┬──────┬──────┬─────┬─────────────┐
│ (index) │ die1 │ die2 │ sum │   result    │
├─────────┼──────┼──────┼─────┼─────────────┤
│    0    │  1   │  4   │  5  │ 'point set' │
│    1    │  3   │  6   │  9  │  'neutral'  │
│    2    │  1   │  5   │  6  │  'neutral'  │
│    3    │  1   │  1   │  2  │  'neutral'  │
│    4    │  4   │  5   │  9  │  'neutral'  │
│    5    │  2   │  3   │  5  │ 'point win' │
│    6    │  3   │  5   │  8  │ 'point set' │
│    7    │  5   │  5   │ 10  │  'neutral'  │
│    8    │  2   │  4   │  6  │  'neutral'  │
│    9    │  2   │  6   │  8  │ 'point win' │
│   10    │  1   │  3   │  4  │ 'point set' │
│   11    │  2   │  4   │  6  │  'neutral'  │
│   12    │  2   │  5   │  7  │ 'seven out' │
└─────────┴──────┴──────┴─────┴─────────────┘
┌───────────────┬────────┐
│    (index)    │ Values │
├───────────────┼────────┤
│   rollCount   │   13   │
│   pointsSet   │   3    │
│   pointsWon   │   2    │
│  comeOutWins  │   0    │
│ comeOutLosses │   0    │
│   neutrals    │   7    │
└───────────────┴────────┘
```

## simulate a game between two teams

```
➜  node bin/game.js team1 team2 | yq r -

# a bunch of yaml...
```
