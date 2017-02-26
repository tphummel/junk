moment = require "moment"

toInt = (val) -> return parseInt val, 10

module.exports = [
  {property: "date", fn: (val) -> return (moment val, "YYYYMMDD").format "YYYY-MM-DD" }
  {property: "sequence"}
  {property: "day_of_week"}
  {property: "visiting_team"}
  {property: "visiting_team_league"}
  {property: "visiting_team_game_number", fn: toInt}
  {property: "home_team"}
  {property: "home_team_league"}
  {property: "home_team_game_number", fn: toInt}
  {property: "visiting_team_score", fn: toInt}
  {property: "home_team_score", fn: toInt}
  {property: "total_outs", fn: toInt}
  {property: "day_night"}
  {property: "completion_detail"}
  {property: "forfeit_detail"}
  {property: "protest_detail"}
  {property: "park_id"}
  {property: "attendance", fn: toInt}
  {property: "duration_minutes", fn: toInt}
  {property: "visiting_team_line_scores"}
  {property: "home_team_line_scores"}

  {property: "visiting_team_at_bats", fn: toInt}
  {property: "visiting_team_hits", fn: toInt}
  {property: "visiting_team_doubles", fn: toInt }
  {property: "visiting_team_triples", fn: toInt }
  {property: "visiting_team_home_runs", fn: toInt }
  {property: "visiting_team_rbi", fn: toInt }
  {property: "visiting_team_sacrifice_hits", fn: toInt }
  {property: "visiting_team_sacrifice_flies", fn: toInt }
  {property: "visiting_team_hit_by_pitch", fn: toInt }
  {property: "visiting_team_walks", fn: toInt }
  {property: "visiting_team_intentional_walks", fn: toInt }
  {property: "visiting_team_strikeouts", fn: toInt }
  {property: "visiting_team_stolen_bases", fn: toInt }
  {property: "visiting_team_caught_stealing", fn: toInt }
  {property: "visiting_team_grounded_into_double_plays", fn: toInt }
  {property: "visiting_team_catchers_interference", fn: toInt }
  {property: "visiting_team_left_on_base", fn: toInt }
  
  {property: "visiting_team_pitchers_used", fn: toInt }
  {property: "visiting_team_individual_earned_runs", fn: toInt }
  {property: "visiting_team_team_earned_runs", fn: toInt }
  {property: "visiting_team_wild_pitches", fn: toInt }
  {property: "visiting_team_balks", fn: toInt }
  
  {property: "visiting_team_putouts", fn: toInt }
  {property: "visiting_team_assists", fn: toInt }
  {property: "visiting_team_errors", fn: toInt }
  {property: "visiting_team_passed_balls", fn: toInt }
  {property: "visiting_team_double_plays", fn: toInt }
  {property: "visiting_team_triple_plays", fn: toInt }
  
  {property: "home_team_at_bats", fn: toInt}
  {property: "home_team_hits", fn: toInt}
  {property: "home_team_doubles", fn: toInt }
  {property: "home_team_triples", fn: toInt }
  {property: "home_team_home_runs", fn: toInt }
  {property: "home_team_rbi", fn: toInt }
  {property: "home_team_sacrifice_hits", fn: toInt }
  {property: "home_team_sacrifice_flies", fn: toInt }
  {property: "home_team_hit_by_pitch", fn: toInt }
  {property: "home_team_walks", fn: toInt }
  {property: "home_team_intentional_walks", fn: toInt }
  {property: "home_team_strikeouts", fn: toInt }
  {property: "home_team_stolen_bases", fn: toInt }
  {property: "home_team_caught_stealing", fn: toInt }
  {property: "home_team_grounded_into_double_plays", fn: toInt }
  {property: "home_team_catchers_interference", fn: toInt }
  {property: "home_team_left_on_base", fn: toInt }
  
  {property: "home_team_pitchers_used", fn: toInt }
  {property: "home_team_individual_earned_runs", fn: toInt }
  {property: "home_team_team_earned_runs", fn: toInt }
  {property: "home_team_wild_pitches", fn: toInt }
  {property: "home_team_balks", fn: toInt }
  
  {property: "home_team_putouts", fn: toInt }
  {property: "home_team_assists", fn: toInt }
  {property: "home_team_errors", fn: toInt }
  {property: "home_team_passed_balls", fn: toInt }
  {property: "home_team_double_plays", fn: toInt }
  {property: "home_team_triple_plays", fn: toInt }
  
  {property: "home_plate_umpire_id"}
  {property: "home_plate_umpire_name"}
  
  {property: "first_base_umpire_id"}
  {property: "first_base_umpire_name"}
  
  {property: "second_base_umpire_id"}
  {property: "second_base_umpire_name"}
  
  {property: "third_base_umpire_id"}
  {property: "third_base_umpire_name"}
  
  {property: "left_field_umpire_id"}
  {property: "left_field_umpire_name"}
  
  {property: "right_field_umpire_id"}
  {property: "right_field_umpire_name"}
  
  {property: "visiting_team_manager_id"}
  {property: "visiting_team_manager_name"}
  
  {property: "home_team_manager_id"}
  {property: "home_team_manager_name"}
  
  {property: "winning_pitcher_id"}
  {property: "winning_pitcher_name"}
  
  {property: "losing_pitcher_id"}
  {property: "losing_pitcher_name"}
  
  {property: "saving_pitcher_id"}
  {property: "saving_pitcher_name"}
  
  {property: "game_winning_rbi_batter_id"}
  {property: "game_winning_rbi_batter_name"}
  {property: "visiting_team_starting_pitcher_id"}
  {property: "visiting_team_starting_pitcher_name"}
  {property: "home_team_starting_pitcher_id"}
  {property: "home_team_starting_pitcher_name"}
  
  {property: "visiting_team_batting_order_1_id"}
  {property: "visiting_team_batting_order_1_name"}
  {property: "visiting_team_batting_order_1_position", fn: toInt}
  {property: "visiting_team_batting_order_2_id"}
  {property: "visiting_team_batting_order_2_name"}
  {property: "visiting_team_batting_order_2_position", fn: toInt}
  {property: "visiting_team_batting_order_3_id"}
  {property: "visiting_team_batting_order_3_name"}
  {property: "visiting_team_batting_order_3_position", fn: toInt}
  {property: "visiting_team_batting_order_4_id"}
  {property: "visiting_team_batting_order_4_name"}
  {property: "visiting_team_batting_order_4_position", fn: toInt}
  {property: "visiting_team_batting_order_5_id"}
  {property: "visiting_team_batting_order_5_name"}
  {property: "visiting_team_batting_order_5_position", fn: toInt}
  {property: "visiting_team_batting_order_6_id"}
  {property: "visiting_team_batting_order_6_name"}
  {property: "visiting_team_batting_order_6_position", fn: toInt}
  {property: "visiting_team_batting_order_7_id"}
  {property: "visiting_team_batting_order_7_name"}
  {property: "visiting_team_batting_order_7_position", fn: toInt}
  {property: "visiting_team_batting_order_8_id"}
  {property: "visiting_team_batting_order_8_name"}
  {property: "visiting_team_batting_order_8_position", fn: toInt}
  {property: "visiting_team_batting_order_9_id"}
  {property: "visiting_team_batting_order_9_name"}
  {property: "visiting_team_batting_order_9_position", fn: toInt}
  
  {property: "home_team_batting_order_1_id"}
  {property: "home_team_batting_order_1_name"}
  {property: "home_team_batting_order_1_position", fn: toInt}
  {property: "home_team_batting_order_2_id"}
  {property: "home_team_batting_order_2_name"}
  {property: "home_team_batting_order_2_position", fn: toInt}
  {property: "home_team_batting_order_3_id"}
  {property: "home_team_batting_order_3_name"}
  {property: "home_team_batting_order_3_position", fn: toInt}
  {property: "home_team_batting_order_4_id"}
  {property: "home_team_batting_order_4_name"}
  {property: "home_team_batting_order_4_position", fn: toInt}
  {property: "home_team_batting_order_5_id"}
  {property: "home_team_batting_order_5_name"}
  {property: "home_team_batting_order_5_position", fn: toInt}
  {property: "home_team_batting_order_6_id"}
  {property: "home_team_batting_order_6_name"}
  {property: "home_team_batting_order_6_position", fn: toInt}
  {property: "home_team_batting_order_7_id"}
  {property: "home_team_batting_order_7_name"}
  {property: "home_team_batting_order_7_position", fn: toInt}
  {property: "home_team_batting_order_8_id"}
  {property: "home_team_batting_order_8_name"}
  {property: "home_team_batting_order_8_position", fn: toInt}
  {property: "home_team_batting_order_9_id"}
  {property: "home_team_batting_order_9_name"}
  {property: "home_team_batting_order_9_position", fn: toInt}
  
  {property: "additional_information"}
  {property: "acquisition_status"}
  
]