(function () {
  var runFile, runFileList;
  var fs    = require("fs"), 
      path  = require("path"),
      async = require("async"),
      csv   = require("csv"),
      db    = require(path.join(__dirname,"../../..", "lib/db"));

  runFile = function(file, cb) {
    var spec, subLevel, inStream, dataDir;

    spec = require(path.join(__dirname,"..",file));
    if (spec.transform == null) {
      spec.transform = function(row) {
        return row;
      } 
    }

    subLevel = db[spec.subLevel];

    if(process.env.NODE_ENV == "test"){
      dataDir = path.join(__dirname, "../../..", "test/fixtures");
    }else{
      dataDir = path.join(__dirname, "../..");
    }

    inFile = path.join(dataDir, spec.dataFile);
    inStream = fs.createReadStream(inFile);

    csv()
      .from(inStream, {columns: true})
      .on('record', function(row, ix){
        var id;
        if(typeof spec.idField == "function") {
          id = spec.idField(row);
        }else{
          id = row[spec.idField];
        }
        
        subLevel.put(id, row);
      })
      .on('error', function(err){
        cb(err)
      })
      .on('end', function(count){
        // console.log(spec.subLevel);
        // console.log("line count: ", count);
        cb(null)
        
      });
  }

  runFileList = function(fileList, cb) {
    async.each(fileList, runFile, cb);
  }

  module.exports = runFileList;

})(this);