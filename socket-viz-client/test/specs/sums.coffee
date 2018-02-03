test = require 'tape'
Sums = require '../../lib/sums/model.coffee'

test "sums", (t) ->
  model = new Sums

  callCount = 0
  model.on 'update', ->
    callCount += 1

    if callCount is 4
      t.ok model.sums.tom, 'has player tom'
      t.ok model.sums.dan, 'has player dan'
      t.equal model.sums.tom.games, 2
      t.equal model.sums.dan.games, 2
      t.end()

  testPerfs = [
    {
      name: 'tom'
      lines: 100
      time: 100
      erank: 2
      wrank: 1
    },
    {
      name: 'dan'
      lines: 110
      time: 100
      erank: 1
      wrank: 2
    },
    {
      name: 'tom'
      lines: 50
      time: 55
      erank: 1
      wrank: 1
    },
    {
      name: 'dan'
      lines: 25
      time: 55
      erank: 2
      wrank: 2
    }

  ]

  model.addPerf testPerfs[0]
  model.addPerf testPerfs[1]
  model.addPerf testPerfs[2]
  model.addPerf testPerfs[3]
