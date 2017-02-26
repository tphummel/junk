#!/usr/bin/env node

(function () {
  var conf;
  var fs          = require("fs"), 
      path        = require("path"),
      async       = require("async"),
      csv         = require("csv"),
      db          = require(path.join(__dirname,"../../..", "lib/db")),
      runFileList = require("./index");

  conf = path.join(__dirname,"../../..","config/build.json");
  fileList = require(conf);

  console.log("_runner starting");
  console.log("fileList to run: ", fileList.length);

  runFileList(fileList, function(err){
    if(err) console.log("err: ", err);
    console.log("done!");
  });

})(this);