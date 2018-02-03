package baseball;

import java.util.Date;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

import com.google.appengine.api.datastore.Key;

@PersistenceCapable
public class BaseballGame {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Date gameDate;
	@Persistent
	private Key seasonId;
	@Persistent
	private String awayTeam;
	@Persistent
	private Integer awayScore=0;
	@Persistent
	private Integer awayHits=0;
	@Persistent
	private Integer awayErrors=0;
	@Persistent
	private Integer awayAtBats=0;
	@Persistent
	private Integer awayRBI=0;
	@Persistent
	private Integer awayBatK=0;
	@Persistent
	private Integer awayBatBB=0;
	@Persistent
	private Integer awaySacFlies=0;
	@Persistent
	private Integer awaySacHits=0;
	@Persistent
	private Integer awayDoublesHit=0;
	@Persistent
	private Integer awayTriplesHit=0;
	@Persistent
	private Integer awayHomersHit=0;
	@Persistent
	private Integer awaySteals=0;
	@Persistent
	private Integer awayCaught=0;
	@Persistent
	private Integer awayDoublePlays=0;
	@Persistent
	private Integer awayOutsPitched=0;
	@Persistent
	private Integer awayWildPitches=0;
	@Persistent
	private Integer awayPassedBalls=0;
	@Persistent
	private Integer awayIntentionalWalks=0;
	@Persistent
	private Integer awayHitBatters=0;
	@Persistent
	private Integer awayPitches=0;
	@Persistent
	private Integer awayStrikes=0;
	@Persistent
	private Integer awayFirstPitchStrikes=0;
	@Persistent
	private Integer awayBattersFaced=0;
	@Persistent
	private Integer awayCalledStrikes=0;
	@Persistent
	private Integer awaySwingingStrikes=0;
	@Persistent
	private Integer awayFoulStrikes=0;
	@Persistent
	private Integer awayInPlayStrikes=0;
	@Persistent
	private Integer awayGroundBalls=0;
	@Persistent
	private Integer awayFlyBalls=0;
	
	@Persistent
	private String homeTeam;
	@Persistent
	private Integer homeScore=0;
	@Persistent
	private Integer homeHits=0;
	@Persistent
	private Integer homeErrors=0;
	@Persistent
	private Integer homeAtBats=0;
	@Persistent
	private Integer homeRBI=0;
	@Persistent
	private Integer homeBatK=0;
	@Persistent
	private Integer homeBatBB=0;
	@Persistent
	private Integer homeSacHits=0;
	@Persistent
	private Integer homeSacFlies=0;
	@Persistent
	private Integer homeDoublesHit=0;
	@Persistent
	private Integer homeTriplesHit=0;
	@Persistent
	private Integer homeHomersHit=0;
	@Persistent
	private Integer homeSteals=0;
	@Persistent
	private Integer homeCaught=0;
	@Persistent
	private Integer homeDoublePlays=0;
	@Persistent
	private Integer homeOutsPitched=0;
	@Persistent
	private Integer homeWildPitches=0;
	@Persistent
	private Integer homePassedBalls=0;
	@Persistent
	private Integer homeIntentionalWalks=0;
	@Persistent
	private Integer homeHitBatters=0;
	@Persistent
	private Integer homePitches=0;
	@Persistent
	private Integer homeStrikes=0;
	@Persistent
	private Integer homeFirstPitchStrikes=0;
	@Persistent
	private Integer homeBattersFaced=0;
	@Persistent
	private Integer homeCalledStrikes=0;
	@Persistent
	private Integer homeSwingingStrikes=0;
	@Persistent
	private Integer homeFoulStrikes=0;
	@Persistent
	private Integer homeInPlayStrikes=0;
	@Persistent
	private Integer homeGroundBalls=0;
	@Persistent
	private Integer homeFlyBalls=0;
	
	public BaseballGame() {
		super();
	}

	public BaseballGame(Key key, Date gameDate, String awayTeam,
			Integer awayScore, String homeTeam, Integer homeScore) {
		super();
		this.key = key;
		this.gameDate = gameDate;
		this.awayTeam = awayTeam;
		this.awayScore = awayScore;
		this.homeTeam = homeTeam;
		this.homeScore = homeScore;
	}

	public Key getKey() {
		return key;
	}

	public void setKey(Key key) {
		this.key = key;
	}

	public Date getGameDate() {
		return gameDate;
	}

	public void setGameDate(Date gameDate) {
		this.gameDate = gameDate;
	}

	public void setSeasonId(Key seasonId) {
		this.seasonId = seasonId;
	}

	public Key getSeasonId() {
		return seasonId;
	}

	public String getAwayTeam() {
		return awayTeam;
	}

	public void setAwayTeam(String awayTeam) {
		this.awayTeam = awayTeam;
	}

	public Integer getAwayScore() {
		return awayScore;
	}

	public void setAwayScore(Integer awayScore) {
		this.awayScore = awayScore;
	}

	public Integer getAwayHits() {
		return awayHits;
	}

	public void setAwayHits(Integer awayHits) {
		this.awayHits = awayHits;
	}

	public Integer getAwayErrors() {
		return awayErrors;
	}

	public void setAwayErrors(Integer awayErrors) {
		this.awayErrors = awayErrors;
	}

	public Integer getAwayAtBats() {
		return awayAtBats;
	}

	public void setAwayAtBats(Integer awayAtBats) {
		this.awayAtBats = awayAtBats;
	}

	public Integer getAwayRBI() {
		return awayRBI;
	}

	public void setAwayRBI(Integer awayRBI) {
		this.awayRBI = awayRBI;
	}

	public Integer getAwayBatK() {
		return awayBatK;
	}

	public void setAwayBatK(Integer awayBatK) {
		this.awayBatK = awayBatK;
	}

	public Integer getAwayBatBB() {
		return awayBatBB;
	}

	public void setAwayBatBB(Integer awayBatBB) {
		this.awayBatBB = awayBatBB;
	}

	public Integer getAwaySacFlies() {
		return awaySacFlies;
	}

	public void setAwaySacFlies(Integer awaySacFlies) {
		this.awaySacFlies = awaySacFlies;
	}

	public Integer getAwaySacHits() {
		return awaySacHits;
	}

	public void setAwaySacHits(Integer awaySacHits) {
		this.awaySacHits = awaySacHits;
	}

	public Integer getAwayDoublesHit() {
		return awayDoublesHit;
	}

	public void setAwayDoublesHit(Integer awayDoublesHit) {
		this.awayDoublesHit = awayDoublesHit;
	}

	public Integer getAwayTriplesHit() {
		return awayTriplesHit;
	}

	public void setAwayTriplesHit(Integer awayTriplesHit) {
		this.awayTriplesHit = awayTriplesHit;
	}

	public Integer getAwayHomersHit() {
		return awayHomersHit;
	}

	public void setAwayHomersHit(Integer awayHomersHit) {
		this.awayHomersHit = awayHomersHit;
	}

	public Integer getAwaySteals() {
		return awaySteals;
	}

	public void setAwaySteals(Integer awaySteals) {
		this.awaySteals = awaySteals;
	}

	public Integer getAwayCaught() {
		return awayCaught;
	}

	public void setAwayCaught(Integer awayCaught) {
		this.awayCaught = awayCaught;
	}

	public Integer getAwayOutsPitched() {
		return awayOutsPitched;
	}

	public void setAwayOutsPitched(Integer awayOutsPitched) {
		this.awayOutsPitched = awayOutsPitched;
	}

	public Integer getAwayWildPitches() {
		return awayWildPitches;
	}

	public void setAwayWildPitches(Integer awayWildPitches) {
		this.awayWildPitches = awayWildPitches;
	}

	public Integer getAwayPassedBalls() {
		return awayPassedBalls;
	}

	public void setAwayPassedBalls(Integer awayPassedBalls) {
		this.awayPassedBalls = awayPassedBalls;
	}

	public Integer getAwayIntentionalWalks() {
		return awayIntentionalWalks;
	}

	public void setAwayIntentionalWalks(Integer awayIntentionalWalks) {
		this.awayIntentionalWalks = awayIntentionalWalks;
	}

	public Integer getAwayHitBatters() {
		return awayHitBatters;
	}

	public void setAwayHitBatters(Integer awayHitBatters) {
		this.awayHitBatters = awayHitBatters;
	}

	public Integer getAwayPitches() {
		return awayPitches;
	}

	public void setAwayPitches(Integer awayPitches) {
		this.awayPitches = awayPitches;
	}

	public Integer getAwayStrikes() {
		return awayStrikes;
	}

	public void setAwayStrikes(Integer awayStrikes) {
		this.awayStrikes = awayStrikes;
	}

	public Integer getAwayFirstPitchStrikes() {
		return awayFirstPitchStrikes;
	}

	public void setAwayFirstPitchStrikes(Integer awayFirstPitchStrikes) {
		this.awayFirstPitchStrikes = awayFirstPitchStrikes;
	}

	public Integer getAwayBattersFaced() {
		return awayBattersFaced;
	}

	public void setAwayBattersFaced(Integer awayBattersFaced) {
		this.awayBattersFaced = awayBattersFaced;
	}

	public Integer getAwayCalledStrikes() {
		return awayCalledStrikes;
	}

	public void setAwayCalledStrikes(Integer awayCalledStrikes) {
		this.awayCalledStrikes = awayCalledStrikes;
	}

	public Integer getAwaySwingingStrikes() {
		return awaySwingingStrikes;
	}

	public void setAwaySwingingStrikes(Integer awaySwingingStrikes) {
		this.awaySwingingStrikes = awaySwingingStrikes;
	}

	public Integer getAwayFoulStrikes() {
		return awayFoulStrikes;
	}

	public void setAwayFoulStrikes(Integer awayFoulStrikes) {
		this.awayFoulStrikes = awayFoulStrikes;
	}

	public Integer getAwayInPlayStrikes() {
		return awayInPlayStrikes;
	}

	public void setAwayInPlayStrikes(Integer awayInPlayStrikes) {
		this.awayInPlayStrikes = awayInPlayStrikes;
	}

	public Integer getAwayGroundBalls() {
		return awayGroundBalls;
	}

	public void setAwayGroundBalls(Integer awayGroundBalls) {
		this.awayGroundBalls = awayGroundBalls;
	}

	public Integer getAwayFlyBalls() {
		return awayFlyBalls;
	}

	public void setAwayFlyBalls(Integer awayFlyBalls) {
		this.awayFlyBalls = awayFlyBalls;
	}

	public String getHomeTeam() {
		return homeTeam;
	}

	public void setHomeTeam(String homeTeam) {
		this.homeTeam = homeTeam;
	}

	public Integer getHomeScore() {
		return homeScore;
	}

	public void setHomeScore(Integer homeScore) {
		this.homeScore = homeScore;
	}

	public Integer getHomeHits() {
		return homeHits;
	}

	public void setHomeHits(Integer homeHits) {
		this.homeHits = homeHits;
	}

	public Integer getHomeErrors() {
		return homeErrors;
	}

	public void setHomeErrors(Integer homeErrors) {
		this.homeErrors = homeErrors;
	}

	public Integer getHomeAtBats() {
		return homeAtBats;
	}

	public void setHomeAtBats(Integer homeAtBats) {
		this.homeAtBats = homeAtBats;
	}

	public Integer getHomeRBI() {
		return homeRBI;
	}

	public void setHomeRBI(Integer homeRBI) {
		this.homeRBI = homeRBI;
	}

	public Integer getHomeBatK() {
		return homeBatK;
	}

	public void setHomeBatK(Integer homeBatK) {
		this.homeBatK = homeBatK;
	}

	public Integer getHomeBatBB() {
		return homeBatBB;
	}

	public void setHomeBatBB(Integer homeBatBB) {
		this.homeBatBB = homeBatBB;
	}

	public Integer getHomeSacHits() {
		return homeSacHits;
	}

	public void setHomeSacHits(Integer homeSacHits) {
		this.homeSacHits = homeSacHits;
	}

	public Integer getHomeSacFlies() {
		return homeSacFlies;
	}

	public void setHomeSacFlies(Integer homeSacFlies) {
		this.homeSacFlies = homeSacFlies;
	}

	public Integer getHomeDoublesHit() {
		return homeDoublesHit;
	}

	public void setHomeDoublesHit(Integer homeDoublesHit) {
		this.homeDoublesHit = homeDoublesHit;
	}

	public Integer getHomeTriplesHit() {
		return homeTriplesHit;
	}

	public void setHomeTriplesHit(Integer homeTriplesHit) {
		this.homeTriplesHit = homeTriplesHit;
	}

	public Integer getHomeHomersHit() {
		return homeHomersHit;
	}

	public void setHomeHomersHit(Integer homeHomersHit) {
		this.homeHomersHit = homeHomersHit;
	}

	public Integer getHomeSteals() {
		return homeSteals;
	}

	public void setHomeSteals(Integer homeSteals) {
		this.homeSteals = homeSteals;
	}

	public Integer getHomeCaught() {
		return homeCaught;
	}

	public void setHomeCaught(Integer homeCaught) {
		this.homeCaught = homeCaught;
	}

	public Integer getHomeOutsPitched() {
		return homeOutsPitched;
	}

	public void setHomeOutsPitched(Integer homeOutsPitched) {
		this.homeOutsPitched = homeOutsPitched;
	}

	public Integer getHomeWildPitches() {
		return homeWildPitches;
	}

	public void setHomeWildPitches(Integer homeWildPitches) {
		this.homeWildPitches = homeWildPitches;
	}

	public Integer getHomePassedBalls() {
		return homePassedBalls;
	}

	public void setHomePassedBalls(Integer homePassedBalls) {
		this.homePassedBalls = homePassedBalls;
	}

	public Integer getHomeIntentionalWalks() {
		return homeIntentionalWalks;
	}

	public void setHomeIntentionalWalks(Integer homeIntentionalWalks) {
		this.homeIntentionalWalks = homeIntentionalWalks;
	}

	public Integer getHomeHitBatters() {
		return homeHitBatters;
	}

	public void setHomeHitBatters(Integer homeHitBatters) {
		this.homeHitBatters = homeHitBatters;
	}

	public Integer getHomePitches() {
		return homePitches;
	}

	public void setHomePitches(Integer homePitches) {
		this.homePitches = homePitches;
	}

	public Integer getHomeStrikes() {
		return homeStrikes;
	}

	public void setHomeStrikes(Integer homeStrikes) {
		this.homeStrikes = homeStrikes;
	}

	public Integer getHomeFirstPitchStrikes() {
		return homeFirstPitchStrikes;
	}

	public void setHomeFirstPitchStrikes(Integer homeFirstPitchStrikes) {
		this.homeFirstPitchStrikes = homeFirstPitchStrikes;
	}

	public Integer getHomeBattersFaced() {
		return homeBattersFaced;
	}

	public void setHomeBattersFaced(Integer homeBattersFaced) {
		this.homeBattersFaced = homeBattersFaced;
	}

	public Integer getHomeCalledStrikes() {
		return homeCalledStrikes;
	}

	public void setHomeCalledStrikes(Integer homeCalledStrikes) {
		this.homeCalledStrikes = homeCalledStrikes;
	}

	public Integer getHomeSwingingStrikes() {
		return homeSwingingStrikes;
	}

	public void setHomeSwingingStrikes(Integer homeSwingingStrikes) {
		this.homeSwingingStrikes = homeSwingingStrikes;
	}

	public Integer getHomeFoulStrikes() {
		return homeFoulStrikes;
	}

	public void setHomeFoulStrikes(Integer homeFoulStrikes) {
		this.homeFoulStrikes = homeFoulStrikes;
	}

	public Integer getHomeInPlayStrikes() {
		return homeInPlayStrikes;
	}

	public void setHomeInPlayStrikes(Integer homeInPlayStrikes) {
		this.homeInPlayStrikes = homeInPlayStrikes;
	}

	public Integer getHomeGroundBalls() {
		return homeGroundBalls;
	}

	public void setHomeGroundBalls(Integer homeGroundBalls) {
		this.homeGroundBalls = homeGroundBalls;
	}

	public Integer getHomeFlyBalls() {
		return homeFlyBalls;
	}

	public void setHomeFlyBalls(Integer homeFlyBalls) {
		this.homeFlyBalls = homeFlyBalls;
	}
	
	

	public Integer getAwayDoublePlays() {
		return awayDoublePlays;
	}

	public void setAwayDoublePlays(Integer awayDoublePlays) {
		this.awayDoublePlays = awayDoublePlays;
	}

	public Integer getHomeDoublePlays() {
		return homeDoublePlays;
	}

	public void setHomeDoublePlays(Integer homeDoublePlays) {
		this.homeDoublePlays = homeDoublePlays;
	}

	@Override
	public String toString() {
		return "BaseballGame [key=" + key + ", gameDate=" + gameDate
				+ ", awayTeam=" + awayTeam + ", awayScore=" + awayScore
				+ ", awayHits=" + awayHits + ", awayErrors=" + awayErrors
				+ ", awayAtBats=" + awayAtBats + ", awayRBI=" + awayRBI
				+ ", awayBatK=" + awayBatK + ", awayBatBB=" + awayBatBB
				+ ", awaySacFlies=" + awaySacFlies + ", awaySacHits="
				+ awaySacHits + ", awayDoublesHit=" + awayDoublesHit
				+ ", awayTriplesHit=" + awayTriplesHit + ", awayHomersHit="
				+ awayHomersHit + ", awaySteals=" + awaySteals
				+ ", awayCaught=" + awayCaught + ", awayDoublePlays="
				+ awayDoublePlays + ", awayOutsPitched=" + awayOutsPitched
				+ ", awayWildPitches=" + awayWildPitches + ", awayPassedBalls="
				+ awayPassedBalls + ", awayIntentionalWalks="
				+ awayIntentionalWalks + ", awayHitBatters=" + awayHitBatters
				+ ", awayPitches=" + awayPitches + ", awayStrikes="
				+ awayStrikes + ", awayFirstPitchStrikes="
				+ awayFirstPitchStrikes + ", awayBattersFaced="
				+ awayBattersFaced + ", awayCalledStrikes=" + awayCalledStrikes
				+ ", awaySwingingStrikes=" + awaySwingingStrikes
				+ ", awayFoulStrikes=" + awayFoulStrikes
				+ ", awayInPlayStrikes=" + awayInPlayStrikes
				+ ", awayGroundBalls=" + awayGroundBalls + ", awayFlyBalls="
				+ awayFlyBalls + ", homeTeam=" + homeTeam + ", homeScore="
				+ homeScore + ", homeHits=" + homeHits + ", homeErrors="
				+ homeErrors + ", homeAtBats=" + homeAtBats + ", homeRBI="
				+ homeRBI + ", homeBatK=" + homeBatK + ", homeBatBB="
				+ homeBatBB + ", homeSacHits=" + homeSacHits
				+ ", homeSacFlies=" + homeSacFlies + ", homeDoublesHit="
				+ homeDoublesHit + ", homeTriplesHit=" + homeTriplesHit
				+ ", homeHomersHit=" + homeHomersHit + ", homeSteals="
				+ homeSteals + ", homeCaught=" + homeCaught
				+ ", homeDoublePlays=" + homeDoublePlays + ", homeOutsPitched="
				+ homeOutsPitched + ", homeWildPitches=" + homeWildPitches
				+ ", homePassedBalls=" + homePassedBalls
				+ ", homeIntentionalWalks=" + homeIntentionalWalks
				+ ", homeHitBatters=" + homeHitBatters + ", homePitches="
				+ homePitches + ", homeStrikes=" + homeStrikes
				+ ", homeFirstPitchStrikes=" + homeFirstPitchStrikes
				+ ", homeBattersFaced=" + homeBattersFaced
				+ ", homeCalledStrikes=" + homeCalledStrikes
				+ ", homeSwingingStrikes=" + homeSwingingStrikes
				+ ", homeFoulStrikes=" + homeFoulStrikes
				+ ", homeInPlayStrikes=" + homeInPlayStrikes
				+ ", homeGroundBalls=" + homeGroundBalls + ", homeFlyBalls="
				+ homeFlyBalls + "]";
	}



	

	
	
	
	
	
}
