redis     = require("redis").createClient() # 6379, "192.241.192.107"

names = ["Neela", "JD", "Dan", "Tom"]
lines = 0
time = 0
count = 1

getPerf = ->
  name = names[count%4]
  lines += 1 + Math.floor((Math.random()*100) % count)
  time += 1 + Math.floor((Math.random()*100) % count)
  count += 1
  perf = {name: name, lines: lines, time: time, erank: 2, wrank: 1}
  lines = 0 if lines > 300
  time = 0 if time > 300
  return perf
      
sendPerf = ->
  perf = getPerf()
  redis.publish "tetris:performances", (JSON.stringify perf)
  
  setTimeout sendPerf, 1500

sendPerf()