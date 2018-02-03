test = require 'tape'
Perf = require '../../lib/perf/model.coffee'

test "perf", (t) ->
  model = new Perf

  callCount = 0
  model.on 'update', (updates) ->
    callCount += 1

    if callCount is 1
      t.equal updates.length, 6
    else if callCount is 2
      t.equal updates.length, 2
    else if callCount is 3
      t.equal updates.length, 3
    else if callCount is 4
      t.equal updates.length, 2
    else
      t.fail 'update fired too many times'

    if callCount is 4
      t.equal model.marks.hi.line[0], 'dan'
      t.equal model.marks.hi.time[0], 'tom'
      t.equal model.marks.hi.rate[0], 'dan'

      t.equal model.marks.lo.line[0], 'dan'
      t.equal model.marks.lo.time[0], 'tom'
      t.equal model.marks.lo.rate[0], 'dan'

      console.log "model.marks: ", model.marks
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
