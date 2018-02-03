# put-json

wrapper for putting json with hyperquest

[![Build Status](https://travis-ci.org/tphummel/put-json.png)](https://travis-ci.org/tphummel/put-json)  
[![NPM](https://nodei.co/npm/put-json.png?downloads=true)](https://nodei.co/npm/put-json/)

## install

    npm install put-json

## test
    
    ./bin/test

## example
    
    var putJson = require("put-json")

    var url = "http://my-put-url.net/path"
    var body = {my: "test", data: "fun"}
    
    putJson url, body, function (err, result) {
      // do stuff
    }