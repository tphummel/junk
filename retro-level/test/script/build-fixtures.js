#!/usr/bin/env node

(function(){
  var fs = require("fs"),
      path = require("path"),
      exec = require("child_process").exec,
      async = require("async"),
      mkdirp = require("mkdirp"),
      dataDir = path.join(__dirname, "../..", "data" ),
      es = require("event-stream"),
      fixturesDir = path.join(__dirname, "../fixtures"),
      fixtureLineLength = 10,
      runSubDir, subDirs, runSubDirs, createFixtureDirs;

  runSubDir = function(subDir, done){
    fs.readdir(path.join(dataDir, subDir), function(err, files){

      async.each(files, (function(file, cb){
        if(!file.match(/\.csv$/)) return cb(null);

        var fullFile = path.join(dataDir, subDir, file),
            cmd = ["head", "-n", fixtureLineLength, fullFile].join(" ");

        exec(cmd, function(err, stdout, stderr){
          if (stderr) return cb(stderr.toString());


          var outFile = path.join(fixturesDir, subDir, file);
          fs.writeFile(outFile, stdout, cb);
        });

      }), done); 

    });
  }

  subDirs = ["lahman"];

  createFixtureDirs = function(done) {
    async.each(subDirs, function(subDir, cb){
      mkdirp(path.join(fixturesDir, subDir), cb);
    }, done)
  }

  runSubDirs = function(cb){
    async.each(subDirs, runSubDir, cb);
  }

  async.series([createFixtureDirs, runSubDirs], function(err){
    if(err) console.log("err: ", err);
    console.log("DONE");
  });


})();