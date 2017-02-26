express = require "express"

port = process.env.PORT or 3000

app.listen port

console.log "Express running on port #{port}"