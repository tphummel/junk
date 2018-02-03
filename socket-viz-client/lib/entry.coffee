client = require "socket.io-client"

host = location.origin.replace /^http/, 'ws'
console.log "host: ", host

socket = client.connect host

Perf = require "./perf/view.coffee"
Sums = require "./sums/view.coffee"

scatter = require "./scatter/index.coffee"

perfDiv = document.querySelector ".row .perfs"
perf = new Perf()
perfDiv.appendChild perf.render().el

sumsDiv = document.querySelector ".row .sums"
sums = new Sums()
sumsDiv.appendChild sums.render().el

socket.on "performance", (data) -> 
  scatter.addPerf data
  perf.addPerf data
  sums.addPerf data