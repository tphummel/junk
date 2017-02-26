request = require "request"
fs      = require "fs"
require "datejs"

url_root = "http://dailybaseballdata.com/cgi-bin/getstats.pl?out=csv"
date_start = date = Date.parse "2012-03-28"
date_end = Date.today()

while (date_start.isBefore date_end)
  date_str = date.toString "Mdd"
  full_url = "http://dailybaseballdata.com/cgi-bin/getstats.pl?out=csv&date=#{date_str}"
  request(full_url).pipe(fs.createWriteStream "./data/2012/html/#{date_str}.html")
  console.log "date: ", date.toString "yyyy-MM-dd"
  date.addDays 1