request = require "request"
fs      = require "fs"
_       = require "underscore"

url_root = "http://dailybaseballdata.com/cgi-bin/getstats.pl?out=csv"

html_dir = "#{__dirname}/data/2012/html/"

convert_file = (i, files, cb) ->
  file = files[i]
  console.log "file: ", file

  data_file_name = (file.split ".")[0]
  full_file = html_dir + file
  csv_file_name = "#{__dirname}/data/2012/csv/#{data_file_name}.csv"
  write_stream = fs.createWriteStream csv_file_name
  
  partial_line = null
  (fs.createReadStream full_file, {encoding: "utf8"})
    .on "error", (err) ->
      console.log "err: ", err
    .on "data", (data) ->
      all_lines = data.split /\r\n|\r|\n/
      csv_lines = _.filter all_lines, (line, i) ->
        
        if (i is 0) or (i is all_lines.length-1)
          get_line = true unless (line.match /^</) or (line.match /^.*=.*/) or (line.match /^$/)
        else if (line.match /^[0-9]{6}/) or (line.match /^"/)
          get_line = true
        else
          get_line = false
          
        return get_line
      
      for line, i in csv_lines
        # console.log "line: ", line
        if i < csv_lines.length-1
          if partial_line?
            line = partial_line + line 
            # console.log "joined line: ", line
            partial_line = null
            
          write_stream.write (line + "\n")
        else
          if partial_line?
            partial_line += line
            # console.log "partial_line added to: ", partial_line
          else
            partial_line = line
            # console.log "partial_line overwritten: ", partial_line
          
  
    .on "end", ->
      console.log "end"
      write_stream.write (partial_line + "\n") if partial_line? 
      write_stream.end()
      if i is files.length - 1
        cb = -> console.log "all done!"
      cb i+1, files, cb

fs.readdir html_dir, (err, files) ->
  # files = ["601.html"]
  convert_file 0, files, convert_file