fs        = require "fs"
assert    = require("chai").assert

parseGameLog = require "../../lib/game_log"

gameLogTxt = fs.readFileSync "#{__dirname}/../fixtures/gamelog2012.txt", "utf8"

describe "Game Log", ->
  beforeEach ->
    @sut = parseGameLog gameLogTxt
    
  it "control", ->
    assert.isTrue true
  it "should set date", ->
    assert.equal @sut.date, "2012-03-28"
  it "should set sequence", ->
    assert.equal @sut.sequence, "0"
  
  it "should set day of week", ->
    assert.equal @sut.day_of_week, "Wed"
  
  it "should set visiting team", ->
    assert.equal @sut.visiting_team, "SEA"
  
  it "should set visiting team league", ->
    assert.equal @sut.visiting_team_league, "AL"
  
  it "should set visiting team game number", ->
    assert.strictEqual @sut.visiting_team_game_number, 1
  
  it "should set home team", ->
    assert.equal @sut.home_team, "OAK"
  
  it "should set home team league", ->
    assert.equal @sut.home_team_league, "AL"
  
  it "should set home team game number", ->
    assert.strictEqual @sut.home_team_game_number, 1
  
  it "should set visiting team score", ->
    assert.strictEqual @sut.visiting_team_score, 3
  
  it "should set home team score", ->
    assert.strictEqual @sut.home_team_score, 1
  
  it "should set the game length in outs", ->
    assert.strictEqual @sut.total_outs, 66
  
  it "should set day/night indicator", ->
    assert.equal @sut.day_night, "N"
  
  it "should set completion_detail", ->
    assert.isNull @sut.completion_detail
  
  it "should set forfeit detail", ->
    assert.isNull @sut.forfeit_detail
  
  it "should set protest detail", ->
    assert.isNull @sut.protest_detail
  
  it "should set the park id", ->
    assert.equal @sut.park_id, "TOK01"
  
  it "should set the attendance", ->
    assert.strictEqual @sut.attendance, 44227
  
  it "should set the duration in minutes", ->
    assert.strictEqual @sut.duration_minutes, 184
  
  it "should set visiting team line scores", ->
    assert.equal @sut.visiting_team_line_scores, "00010000002"
  
  it "should set home team line scores", ->
    assert.equal @sut.home_team_line_scores, "00010000000"
  
  it "should set visiting team bat stats", ->
    assert.strictEqual @sut.visiting_team_at_bats, 39
    assert.strictEqual @sut.visiting_team_hits, 9
    assert.strictEqual @sut.visiting_team_doubles, 1
    assert.strictEqual @sut.visiting_team_triples, 0
    assert.strictEqual @sut.visiting_team_home_runs, 1
    assert.strictEqual @sut.visiting_team_rbi, 3
    assert.strictEqual @sut.visiting_team_sacrifice_hits, 1
    assert.strictEqual @sut.visiting_team_sacrifice_flies, 0
    assert.strictEqual @sut.visiting_team_hit_by_pitch, 0
    assert.strictEqual @sut.visiting_team_walks, 0
    assert.strictEqual @sut.visiting_team_intentional_walks, 0
    assert.strictEqual @sut.visiting_team_strikeouts, 4
    assert.strictEqual @sut.visiting_team_stolen_bases, 2
    assert.strictEqual @sut.visiting_team_caught_stealing, 1
    assert.strictEqual @sut.visiting_team_grounded_into_double_plays, 1
    assert.strictEqual @sut.visiting_team_catchers_interference, 0
    assert.strictEqual @sut.visiting_team_left_on_base, 4
  
  it "should set visiting team pit stats", ->
    assert.strictEqual @sut.visiting_team_pitchers_used, 3
    assert.strictEqual @sut.visiting_team_individual_earned_runs, 1
    assert.strictEqual @sut.visiting_team_team_earned_runs, 1
    assert.strictEqual @sut.visiting_team_wild_pitches, 0
    assert.strictEqual @sut.visiting_team_balks, 0
  
  it "should set visiting team def stats", ->
    assert.strictEqual @sut.visiting_team_putouts, 33
    assert.strictEqual @sut.visiting_team_assists, 7
    assert.strictEqual @sut.visiting_team_errors, 1
    assert.strictEqual @sut.visiting_team_passed_balls, 0
    assert.strictEqual @sut.visiting_team_double_plays, 0
    assert.strictEqual @sut.visiting_team_triple_plays, 0
  
  it "should set home team bat stats", ->
    assert.strictEqual @sut.home_team_at_bats, 39
    assert.strictEqual @sut.home_team_hits, 6
    assert.strictEqual @sut.home_team_doubles, 3
    assert.strictEqual @sut.home_team_triples, 0
    assert.strictEqual @sut.home_team_home_runs, 0
    assert.strictEqual @sut.home_team_rbi, 1
    assert.strictEqual @sut.home_team_sacrifice_hits, 0
    assert.strictEqual @sut.home_team_sacrifice_flies, 0
    assert.strictEqual @sut.home_team_hit_by_pitch, 2
    assert.strictEqual @sut.home_team_walks, 0
    assert.strictEqual @sut.home_team_intentional_walks, 0
    assert.strictEqual @sut.home_team_strikeouts, 10
    assert.strictEqual @sut.home_team_stolen_bases, 2
    assert.strictEqual @sut.home_team_caught_stealing, 1
    assert.strictEqual @sut.home_team_grounded_into_double_plays, 0
    assert.strictEqual @sut.home_team_catchers_interference, 0
    assert.strictEqual @sut.home_team_left_on_base, 7
  
  it "should set home team pit stats", ->
    assert.strictEqual @sut.home_team_pitchers_used, 6
    assert.strictEqual @sut.home_team_individual_earned_runs, 3
    assert.strictEqual @sut.home_team_team_earned_runs, 3
    assert.strictEqual @sut.home_team_wild_pitches, 0
    assert.strictEqual @sut.home_team_balks, 0
  
  it "should set home team def stats", ->
    assert.strictEqual @sut.home_team_putouts, 33
    assert.strictEqual @sut.home_team_assists, 19
    assert.strictEqual @sut.home_team_errors, 1
    assert.strictEqual @sut.home_team_passed_balls, 0
    assert.strictEqual @sut.home_team_double_plays, 1
    assert.strictEqual @sut.home_team_triple_plays, 0
  
  it "should set the home plate umpire id and name", ->
    assert.equal @sut.home_plate_umpire_id, "hallt901"
    assert.equal @sut.home_plate_umpire_name, "Tom Hallion"
  
  it "should set the 1b umpire id and name", ->
    assert.equal @sut.first_base_umpire_id, "nelsj901"
    assert.equal @sut.first_base_umpire_name, "Jeff Nelson"
  
  it "should set the 2b umpire id and name", ->
    assert.equal @sut.second_base_umpire_id, "hudsm901"
    assert.equal @sut.second_base_umpire_name, "Marvin Hudson"
  
  it "should set the 3b umpire id and name", ->
    assert.equal @sut.third_base_umpire_id, "belld901"
    assert.equal @sut.third_base_umpire_name, "Dan Bellino"
  
  it "should set the LF umpire id and name", ->
    assert.isNull @sut.left_field_umpire_id
    assert.equal @sut.left_field_umpire_name, "(none)"

  it "should set the RF umpire id and name", ->
    assert.isNull @sut.right_field_umpire_id
    assert.equal @sut.right_field_umpire_name, "(none)"
  
  it "should set the visiting manager id and name", ->
    assert.equal @sut.visiting_team_manager_id, "wedge001"
    assert.equal @sut.visiting_team_manager_name, "Eric Wedge"
  
  it "should set the home manager id and name", ->
    assert.equal @sut.home_team_manager_id, "melvb001"
    assert.equal @sut.home_team_manager_name, "Bob Melvin"
  
  it "should set the pitchers of record", ->
    assert.equal @sut.winning_pitcher_id, "wilht001"
    assert.equal @sut.winning_pitcher_name, "Tom Wilhelmsen"
    assert.equal @sut.losing_pitcher_id, "caria001"
    assert.equal @sut.losing_pitcher_name, "Andrew Carignan"
    assert.equal @sut.saving_pitcher_id, "leagb001"
    assert.equal @sut.saving_pitcher_name, "Brandon League"
  
  it "should set the game winning rbi batter", ->
    assert.equal @sut.game_winning_rbi_batter_id, "ackld001"
    assert.equal @sut.game_winning_rbi_batter_name, "Dustin Ackley"
  
  it "should set the starting pitchers", ->
    assert.equal @sut.visiting_team_starting_pitcher_id, "hernf002"
    assert.equal @sut.visiting_team_starting_pitcher_name, "Felix Hernandez"
    assert.equal @sut.home_team_starting_pitcher_id, "mccab001"
    assert.equal @sut.home_team_starting_pitcher_name, "Brandon McCarthy"
    
  it "should set the visiting starting lineup", ->
    assert.equal @sut.visiting_team_batting_order_1_id, "figgc001"
    assert.equal @sut.visiting_team_batting_order_1_name, "Chone Figgins"
    assert.strictEqual @sut.visiting_team_batting_order_1_position, 5
    assert.equal @sut.visiting_team_batting_order_2_id, "ackld001"
    assert.equal @sut.visiting_team_batting_order_2_name, "Dustin Ackley"
    assert.strictEqual @sut.visiting_team_batting_order_2_position, 4
    assert.equal @sut.visiting_team_batting_order_3_id, "suzui001"
    assert.equal @sut.visiting_team_batting_order_3_name, "Ichiro Suzuki"
    assert.strictEqual @sut.visiting_team_batting_order_3_position, 9
    assert.equal @sut.visiting_team_batting_order_4_id, "smoaj001"
    assert.equal @sut.visiting_team_batting_order_4_name, "Justin Smoak"
    assert.strictEqual @sut.visiting_team_batting_order_4_position, 3    
    assert.equal @sut.visiting_team_batting_order_5_id, "montj003"
    assert.equal @sut.visiting_team_batting_order_5_name, "Jesus Montero"
    assert.strictEqual @sut.visiting_team_batting_order_5_position, 10
    assert.equal @sut.visiting_team_batting_order_6_id, "carpm001"
    assert.equal @sut.visiting_team_batting_order_6_name, "Mike Carp"
    assert.strictEqual @sut.visiting_team_batting_order_6_position, 7
    assert.equal @sut.visiting_team_batting_order_7_id, "olivm001"
    assert.equal @sut.visiting_team_batting_order_7_name, "Miguel Olivo"
    assert.strictEqual @sut.visiting_team_batting_order_7_position, 2
    assert.equal @sut.visiting_team_batting_order_8_id, "saunm001"
    assert.equal @sut.visiting_team_batting_order_8_name, "Michael Saunders"
    assert.strictEqual @sut.visiting_team_batting_order_8_position, 8
    assert.equal @sut.visiting_team_batting_order_9_id, "ryanb002"
    assert.equal @sut.visiting_team_batting_order_9_name, "Brendan Ryan"
    assert.strictEqual @sut.visiting_team_batting_order_9_position, 6
    
  it "should set the home starting lineup", ->
    assert.equal @sut.home_team_batting_order_1_id, "weekj001"
    assert.equal @sut.home_team_batting_order_1_name, "Jemile Weeks"
    assert.strictEqual @sut.home_team_batting_order_1_position, 4
    assert.equal @sut.home_team_batting_order_2_id, "pennc001"
    assert.equal @sut.home_team_batting_order_2_name, "Cliff Pennington"
    assert.strictEqual @sut.home_team_batting_order_2_position, 6
    assert.equal @sut.home_team_batting_order_3_id, "crisc001"
    assert.equal @sut.home_team_batting_order_3_name, "Coco Crisp"
    assert.strictEqual @sut.home_team_batting_order_3_position, 7
    assert.equal @sut.home_team_batting_order_4_id, "smits002"
    assert.equal @sut.home_team_batting_order_4_name, "Seth Smith"
    assert.strictEqual @sut.home_team_batting_order_4_position, 10  
    assert.equal @sut.home_team_batting_order_5_id, "suzuk001"
    assert.equal @sut.home_team_batting_order_5_name, "Kurt Suzuki"
    assert.strictEqual @sut.home_team_batting_order_5_position, 2
    assert.equal @sut.home_team_batting_order_6_id, "reddj001"
    assert.equal @sut.home_team_batting_order_6_name, "Josh Reddick"
    assert.strictEqual @sut.home_team_batting_order_6_position, 9
    assert.equal @sut.home_team_batting_order_7_id, "cespy001"
    assert.equal @sut.home_team_batting_order_7_name, "Yoenis Cespedes"
    assert.strictEqual @sut.home_team_batting_order_7_position, 8
    assert.equal @sut.home_team_batting_order_8_id, "alleb001"
    assert.equal @sut.home_team_batting_order_8_name, "Brandon Allen"
    assert.strictEqual @sut.home_team_batting_order_8_position, 3
    assert.equal @sut.home_team_batting_order_9_id, "sogae001"
    assert.equal @sut.home_team_batting_order_9_name, "Eric Sogard"
    assert.strictEqual @sut.home_team_batting_order_9_position, 5
  
  it "should set additional information", ->
    assert.isNull @sut.additional_information
  
  it "should set acquisition_status", ->
    assert.equal @sut.acquisition_status, "Y"