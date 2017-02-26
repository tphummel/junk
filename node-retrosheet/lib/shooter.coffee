walk = require "walk"
exec = require("child_process").exec
outputDir = "#{__dirname}/data/csv"

runDir = (dir) ->
  walker = walk.walk dir
  walker.on "file", (root, fileStats, next) ->
    if fileStats.name.match /.*\.EV(A|N)/
      file = "#{root}/#{fileStats.name}"
      console.log "match: ", file
      outputFile = outputDir + fileStats.name.split(".")[0] + ".csv"
      
      cmd = "cwevent -n -f 0-96 -x 0-62 #{file} > #{outputFile}"
      exec cmd, (err, stdOut, stdErr) ->
        console.log "err: ", err 
        console.log "stdOut: ", stdOut
        console.log "stdErr: ", stdErr
      
    next()
  
  walker.on "errors", (root, nodeStatsArray, next) ->
    console.log "nodeStatsArray: ", nodeStatsArray
    next()
  
  walker.on "end", ->
    console.log "all done"
    

runDir "#{__dirname}/data/raw/2012eve"