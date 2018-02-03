client = require "socket.io-client"

host = location.origin.replace /^http/, 'ws'
console.log "host: ", host

socket = client.connect host

Perf = require "./perf/index.coffee"
Sums = require "./sums/index.coffee"

scatter = require "./scatter/index.coffee"

perf = new Perf {el: (document.querySelector ".row .perfs")}
sums = new Sums {el: (document.querySelector ".row .sums")}

socket.on "performance", (data) -> 
  scatter.addPerf data
  perf.addPerf data
  sums.addPerf data