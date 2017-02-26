_                = require "underscore"
csvToStringArray = require "#{__dirname}/helpers/csv"

parseEvents = (csvText) ->
  events = []
  lines = csvText.split "\n"
  console.log "lines.length: ", lines.length
  
  for line in lines
    event = parseEvent line
    events.push event
  
  return events

parseEvent = (csvLine) ->
  row = csvToStringArray csvLine
  
  event = {type: row[0]}
  
  switch event.type
  
  when "info"
    event.key = row[1]
    event.value = row[2]
    
  when "start", "sub"
    event.playerId = row[1]
    event.playerName = row[2]
    event.homeVisitor = if row[3] is "0" then "visitor" else if row[3] is "1" then "home"
    event.battingOrderPosition = parseInt row[4], 10
    event.defensivePosition = parseInt row[5], 10
  
  when "com"
    event.message = row[1]
  
  when "play"
    event.inning = parseInt row[1], 10
    event.homeVisitor = if row[2] is "0" then "visitor" else if row[3] is "1" then "home"
    event.playerId = row[3]
    event.count = if row[4] is "??" then null else row[4]
    
    paDetail = row[5]
    
    playDetail = playrow[6]
  
  return event
  
parsePlateAppearanceDetail = (raw) ->
  pitchTypes = 
    "C": "called strike"
    
    
    # +  following pickoff throw by the catcher
    # *  indicates the following pitch was blocked by the catcher
    # .  marker for play not involving the batter
    # 1  pickoff throw to first
    # 2  pickoff throw to second
    # 3  pickoff throw to third
    # >  Indicates a runner going on the pitch
    # 
    # B  ball
    # C  called strike
    # F  foul
    # H  hit batter
    # I  intentional ball
    # K  strike (unknown type)
    # L  foul bunt
    # M  missed bunt attempt
    # N  no pitch (on balks and interference calls)
    # O  foul tip on bunt
    # P  pitchout
    # Q  swinging on pitchout
    # R  foul ball on pitchout
    # S  swinging strike
    # T  foul tip
    # U  unknown or missed pitch
    # V  called ball because pitcher went to his mouth
    # X  ball put into play by batter
    # Y  ball put into play on pitchout
  
  
parseResultDetail = (raw) ->


module.exports = parseEvents