fs      = require "fs"
csv     = require "csv"
_       = require "underscore"
require "datejs"

csv_dir = "#{__dirname}/data/2012/csv/"
output_dir = "#{__dirname}/data/2012/sql/"

pit_sql = "#{output_dir}pit_gm.sql"
pit_stream = fs.createWriteStream pit_sql

bat_sql = "#{output_dir}bat_gm.sql"
bat_stream = fs.createWriteStream bat_sql

misc_sql = "#{output_dir}misc_gm.sql"
misc_stream = fs.createWriteStream misc_sql

current_season = 2012

make_bat_gm_sql = (data) ->
  sql = 
  "(nextval('bat_gm_id'),#{data['MLB ID']},#{current_season},'#{data.Name}','#{data.Team}','#{data.Game}','#{data.Result}',
  '#{data.date}',#{data['Game#']},'#{data['Position(s)']}',#{data.starter},
  #{data.AB},#{data.H},#{data['2B']},#{data['3B']},#{data.HR},#{data.R},#{data.RBI},
  #{data.BB},#{data.IBB},#{data.HBP},#{data.SO},#{data.SB},#{data.CS},#{data['Picked Off']},
  #{data.Sac},#{data.SF},#{data.E},#{data.PB},#{data.LOB}, #{data.GIDP}
  )"
  
  return sql

make_pit_gm_sql = (data) ->
  if data.IP?
    ip_pieces = data.IP.split "."
    full_inn_outs = (parseInt ip_pieces[0]) * 3
    inn_frag_outs = parseInt ip_pieces[1]
    data.outs_pitched = full_inn_outs + inn_frag_outs
  else
    data.outs_pitched = 0
  
  sql = 
  "(nextval('pit_gm_id'),#{data['MLB ID']},#{current_season},'#{data.Name}','#{data.Team}','#{data.Game}','#{data.Result}',
  '#{data.date}',#{data['Game#']},'#{data['Position(s)']}',#{data.starter},
  #{data.outs_pitched},#{data['Hits allowed']},#{data['Runs allowed']},#{data.ER},
  #{data.Walk},#{data['Intl Walk']},#{data.K},#{data.HB},#{data.Pickoffs},
  #{data['HR allowed']},#{data.WP},#{data.Win},#{data.Loss},#{data.Save},#{data.BS},
  #{data.Hold},#{data.CG}
  )"

  return sql

check_whitelist = (date, team) ->
  whitelist = 
    "2012-03-28": ["OAK","SEA"]
    "2012-03-29": ["OAK","SEA"]
    "2012-03-30": []
    "2012-03-31": []
    "2012-04-01": []
    "2012-04-02": []
    "2012-04-03": []
    "2012-04-04": []
    "2012-04-05": ["MIA","STL"]
    "2012-07-10": [] # all star game
  
  if whitelist[date]?
    allowed_teams = whitelist[date]
    allowed = _.include allowed_teams, team
    return allowed
  else 
    return true

get_date_from_filename = (filename) ->
  date_shorthand = (filename.split ".")[0]

  month = parseInt (date_shorthand.substring 0, 1)
  
  day_str = date_shorthand.substring 1, 3

  # trim leading zeroes
  trimmed = day_str.replace /^[0]+/g, ""

  day = parseInt trimmed
  
  game_date = (new Date 2012, month-1, day).toString "yyyy-MM-dd"
  
  return game_date

convert_file = (i, files, cb) ->
  file = files[i]
  full_file = csv_dir + file
  console.log "file: ", file
  
  game_date = get_date_from_filename file
  console.log "game_date: ", game_date
  
  counts = {bat: 0, pit: 0, misc: 0}
  
  csv()
  .fromStream((fs.createReadStream full_file, {encoding: "utf8"}), {columns: true, trim: true})
    
  .on "error", (err) ->
    console.log "csv parse err: ", err.message
    
  .on "data", (data, ix) ->
    
    data.date = game_date
    if (check_whitelist data.date, data.Team)
      data.Name = data.Name.replace "'", "''" if data.Name?
      
      switch data["H/P"]
      
        when "H"
          bat_stream.write "INSERT INTO bat_gm VALUES " if counts.bat is 0
        
          sql = make_bat_gm_sql data
          line = sql + "\n"
          line = "," + line unless counts.bat is 0
          bat_stream.write line
          counts.bat += 1
        
        when "P"
          pit_stream.write "INSERT INTO pit_gm VALUES " if counts.pit is 0
    
          sql = make_pit_gm_sql data
          line = sql + "\n"
          line = "," + line unless counts.pit is 0
      
          pit_stream.write line
          counts.pit += 1
        
        else
          misc_stream.write ((JSON.stringify data) + "\n")
          counts.misc += 1
  
  .on "end", ->
    if i is files.length - 1
      cb = -> 
        pit_stream.end()
        bat_stream.end()
        misc_stream.end()
        console.log "all done!"
        
    pit_stream.write ";\n" if counts.pit > 0
    bat_stream.write ";\n" if counts.bat > 0
    
    cb i+1, files, cb

fs.readdir csv_dir, (err, files) ->
  convert_file 0, files, convert_file