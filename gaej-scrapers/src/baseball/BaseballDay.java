package baseball;

import java.util.ArrayList;
import java.util.Date;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;


import org.apache.commons.math.stat.StatUtils;
import org.apache.commons.math.stat.descriptive.moment.StandardDeviation;

import com.google.appengine.api.datastore.Key;

@PersistenceCapable
public class BaseballDay {
	public static final String actionCategory1 = "Strike Pct";
	public static final String actionCategory2 = "Grounder Pct";
	public static final String actionCategory3 = "Total OPS";

	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Key seasonId;
	@Persistent
	private String seasonName;
	@Persistent
	private Date date;
	@Persistent
	private Integer numGames = 0;
	@Persistent
	private Integer score = 0;
	@Persistent
	private Integer hits = 0;
	@Persistent
	private Integer errors = 0;
	@Persistent
	private Integer atBats = 0;
	@Persistent
	private Integer plateAppearances = 0;
	@Persistent
	private Integer battedIn = 0;
	@Persistent
	private Integer strikeouts = 0;
	@Persistent
	private Integer walks = 0;
	@Persistent
	private Integer sacHits = 0;
	@Persistent
	private Integer sacFlies = 0;
	@Persistent
	private Integer doubles = 0;
	@Persistent
	private Integer triples = 0;
	@Persistent
	private Integer homers = 0;
	@Persistent
	private Integer steals = 0;
	@Persistent
	private Integer caught = 0;
	@Persistent
	private Integer doublePlays = 0;
	@Persistent
	private Integer outsPitched = 0;
	@Persistent
	private Integer wildPitches = 0;
	@Persistent
	private Integer passedBalls = 0;
	@Persistent
	private Integer intentionalWalks = 0;
	@Persistent
	private Integer hitBatters = 0;
	@Persistent
	private Integer pitches = 0;
	@Persistent
	private Integer strikes = 0;
	@Persistent
	private Integer firstPitchStrikes = 0;
	@Persistent
	private Integer calledStrikes = 0;
	@Persistent
	private Integer swingingStrikes = 0;
	@Persistent
	private Integer foulStrikes = 0;
	@Persistent
	private Integer inPlayStrikes = 0;
	@Persistent
	private Integer groundBalls = 0;
	@Persistent
	private Integer airBalls = 0;
	
	
	@Persistent
	private Double kpctMA = null;
	@Persistent
	private Double kpctS = null;
	@Persistent
	private Double kpctZ = null;
	@Persistent
	private Double gpctMA = null;
	@Persistent
	private Double gpctS = null;
	@Persistent
	private Double gpctZ = null;
	@Persistent
	private Double opsMA = null;
	@Persistent
	private Double opsS = null;
	@Persistent
	private Double opsZ = null;
	@Persistent
	private Integer numGamesDuringTrailingDays = null;

	public BaseballDay() {
		super();
	}

	// iterate over day's games. sum day results columns. don't change anything we set at init this morning
	public void sumDaysGames(ArrayList<BaseballGame> games){
		//System.out.println("in sumdaysgames");
		this.score = 0;
		this.hits = 0;
		this.errors = 0;
		this.atBats = 0;
		this.battedIn = 0;
		this.strikeouts = 0;
		this.walks = 0;
		this.sacFlies = 0;
		this.sacHits = 0;
		this.doubles = 0;
		this.triples = 0;
		this.homers = 0;
		this.steals = 0;
		this.caught = 0;
		this.outsPitched = 0;
		this.plateAppearances = 0;
		this.wildPitches = 0;
		this.passedBalls = 0;
		this.intentionalWalks = 0;
		this.hitBatters = 0;
		this.pitches = 0;
		this.strikes = 0;
		this.firstPitchStrikes = 0;
		this.calledStrikes = 0;
		this.swingingStrikes = 0;
		this.foulStrikes = 0;
		this.inPlayStrikes = 0;
		this.groundBalls = 0;
		this.airBalls = 0;
		this.doublePlays = 0;
		
		for(BaseballGame game : games){
			game.setSeasonId(this.seasonId);
			//System.out.println(game.toString());
			this.score += (game.getHomeScore()+game.getAwayScore());
			this.hits += game.getAwayHits()+game.getHomeHits();
			this.errors += game.getAwayErrors()+game.getHomeErrors();
			this.atBats += game.getAwayAtBats()+game.getHomeAtBats();
			this.battedIn += game.getAwayRBI()+game.getHomeRBI();
			this.strikeouts += game.getAwayBatK()+game.getHomeBatK();
			this.walks += game.getAwayBatBB()+game.getHomeBatBB();
			this.sacHits += game.getAwaySacHits()+game.getHomeSacHits();
			this.sacFlies += game.getAwaySacFlies()+game.getHomeSacFlies();
			this.doubles += game.getAwayDoublesHit()+game.getHomeDoublesHit();
			this.triples += game.getAwayTriplesHit()+game.getHomeTriplesHit();
			this.homers += game.getAwayHomersHit()+game.getHomeHomersHit();
			this.steals += game.getAwaySteals()+game.getHomeSteals();
			this.caught += game.getAwayCaught()+game.getHomeCaught();
			this.outsPitched += game.getAwayOutsPitched()+game.getHomeOutsPitched();
			this.plateAppearances += game.getAwayBattersFaced()+game.getHomeBattersFaced();
			this.wildPitches += game.getAwayWildPitches()+game.getHomeWildPitches();
			this.passedBalls += game.getAwayPassedBalls()+game.getHomePassedBalls();
			this.intentionalWalks += game.getAwayIntentionalWalks()+game.getHomeIntentionalWalks();
			this.hitBatters += game.getAwayHitBatters()+game.getHomeHitBatters();
			this.pitches += game.getAwayPitches()+game.getHomePitches();
			this.strikes += game.getAwayStrikes()+game.getHomeStrikes();
			this.firstPitchStrikes += game.getAwayFirstPitchStrikes()+game.getHomeFirstPitchStrikes();
			this.calledStrikes += game.getAwayCalledStrikes()+game.getHomeCalledStrikes();
			this.swingingStrikes += game.getAwaySwingingStrikes()+game.getHomeSwingingStrikes();
			this.foulStrikes += game.getAwayFoulStrikes()+game.getHomeFoulStrikes();
			this.inPlayStrikes += game.getAwayInPlayStrikes()+game.getHomeInPlayStrikes();
			this.groundBalls += game.getAwayGroundBalls()+game.getHomeGroundBalls();
			this.airBalls += game.getAwayFlyBalls()+game.getHomeFlyBalls();
			this.doublePlays += game.getAwayDoublePlays()+game.getHomeDoublePlays();
		}
	}

	public Key getKey() {
		return key;
	}

	public void setKey(Key key) {
		this.key = key;
	}

	public Key getSeasonId() {
		return seasonId;
	}

	public void setSeasonId(Key seasonId) {
		this.seasonId = seasonId;
	}

	public void setSeasonName(String seasonName) {
		this.seasonName = seasonName;
	}

	public String getSeasonName() {
		return seasonName;
	}

	public Date getDate() {
		return date;
	}

	public void setDate(Date date) {
		this.date = date;
	}

	public Integer getNumGames() {
		return numGames;
	}

	public void setNumGames(Integer numGames) {
		this.numGames = numGames;
	}

	public Integer getScore() {
		return score;
	}

	public void setScore(Integer score) {
		this.score = score;
	}

	public Integer getHits() {
		return hits;
	}

	public void setHits(Integer hits) {
		this.hits = hits;
	}

	public Integer getErrors() {
		return errors;
	}

	public void setErrors(Integer errors) {
		this.errors = errors;
	}

	public Integer getAtBats() {
		return atBats;
	}

	public void setAtBats(Integer atBats) {
		this.atBats = atBats;
	}

	public Integer getBattedIn() {
		return battedIn;
	}

	public void setBattedIn(Integer battedIn) {
		this.battedIn = battedIn;
	}

	public Integer getStrikeouts() {
		return strikeouts;
	}

	public void setStrikeouts(Integer strikeouts) {
		this.strikeouts = strikeouts;
	}

	public Integer getWalks() {
		return walks;
	}

	public void setWalks(Integer walks) {
		this.walks = walks;
	}

	public Integer getSacHits() {
		return sacHits;
	}

	public void setSacHits(Integer sacHits) {
		this.sacHits = sacHits;
	}

	public Integer getSacFlies() {
		return sacFlies;
	}

	public void setSacFlies(Integer sacFlies) {
		this.sacFlies = sacFlies;
	}

	public Integer getDoubles() {
		return doubles;
	}

	public void setDoubles(Integer doubles) {
		this.doubles = doubles;
	}

	public Integer getTriples() {
		return triples;
	}

	public void setTriples(Integer triples) {
		this.triples = triples;
	}

	public Integer getHomers() {
		return homers;
	}

	public void setHomers(Integer homers) {
		this.homers = homers;
	}

	public Integer getSteals() {
		return steals;
	}

	public void setSteals(Integer steals) {
		this.steals = steals;
	}

	public Integer getCaught() {
		return caught;
	}

	public void setCaught(Integer caught) {
		this.caught = caught;
	}

	public Integer getOutsPitched() {
		return outsPitched;
	}

	public void setOutsPitched(Integer innPitched) {
		this.outsPitched = innPitched;
	}

	public Integer getWildPitches() {
		return wildPitches;
	}

	public void setWildPitches(Integer wildPitches) {
		this.wildPitches = wildPitches;
	}

	public Integer getIntentionalWalks() {
		return intentionalWalks;
	}

	public void setIntentionalWalks(Integer intentionalWalks) {
		this.intentionalWalks = intentionalWalks;
	}

	public Integer getHitBatters() {
		return hitBatters;
	}

	public void setHitBatters(Integer hitBatters) {
		this.hitBatters = hitBatters;
	}

	public Integer getPitches() {
		return pitches;
	}

	public void setPitches(Integer pitches) {
		this.pitches = pitches;
	}

	public Integer getStrikes() {
		return strikes;
	}

	public void setStrikes(Integer strikes) {
		this.strikes = strikes;
	}

	public Integer getFirstPitchStrikes() {
		return firstPitchStrikes;
	}

	public void setFirstPitchStrikes(Integer firstPitchStrikes) {
		this.firstPitchStrikes = firstPitchStrikes;
	}

	public Integer getCalledStrikes() {
		return calledStrikes;
	}

	public void setCalledStrikes(Integer calledStrikes) {
		this.calledStrikes = calledStrikes;
	}

	public Integer getSwingingStrikes() {
		return swingingStrikes;
	}

	public void setSwingingStrikes(Integer swingingStrikes) {
		this.swingingStrikes = swingingStrikes;
	}

	public Integer getFoulStrikes() {
		return foulStrikes;
	}

	public void setFoulStrikes(Integer foulStrikes) {
		this.foulStrikes = foulStrikes;
	}

	public Integer getInPlayStrikes() {
		return inPlayStrikes;
	}

	public void setInPlayStrikes(Integer inPlayStrikes) {
		this.inPlayStrikes = inPlayStrikes;
	}

	public Integer getGroundBalls() {
		return groundBalls;
	}

	public void setGroundBalls(Integer groundBalls) {
		this.groundBalls = groundBalls;
	}

	public Integer getAirBalls() {
		return airBalls;
	}

	public void setAirBalls(Integer airBalls) {
		this.airBalls = airBalls;
	}

	public Integer getPlateAppearances() {
		return plateAppearances;
	}

	public void setPlateAppearances(Integer plateAppearances) {
		this.plateAppearances = plateAppearances;
	}

	public Integer getDoublePlays() {
		return doublePlays;
	}

	public void setDoublePlays(Integer doublePlays) {
		this.doublePlays = doublePlays;
	}

	public Integer getPassedBalls() {
		return passedBalls;
	}

	public void setPassedBalls(Integer passedBalls) {
		this.passedBalls = passedBalls;
	}

	public Double getKpctMA() {
		return kpctMA;
	}

	public void setKpctMA(Double kpctMA) {
		this.kpctMA = kpctMA;
	}

	public Double getKpctS() {
		return kpctS;
	}

	public void setKpctS(Double kpctS) {
		this.kpctS = kpctS;
	}

	public Double getKpctZ() {
		return kpctZ;
	}

	public void setKpctZ(Double kpctZ) {
		this.kpctZ = kpctZ;
	}

	public Double getGpctMA() {
		return gpctMA;
	}

	public void setGpctMA(Double gpctMA) {
		this.gpctMA = gpctMA;
	}

	public Double getGpctS() {
		return gpctS;
	}

	public void setGpctS(Double gpctS) {
		this.gpctS = gpctS;
	}

	public Double getGpctZ() {
		return gpctZ;
	}

	public void setGpctZ(Double gpctZ) {
		this.gpctZ = gpctZ;
	}

	public Double getOpsMA() {
		return opsMA;
	}

	public void setOpsMA(Double opsMA) {
		this.opsMA = opsMA;
	}

	public Double getOpsS() {
		return opsS;
	}

	public void setOpsS(Double opsS) {
		this.opsS = opsS;
	}

	public Double getOpsZ() {
		return opsZ;
	}

	public void setOpsZ(Double opsZ) {
		this.opsZ = opsZ;
	}
	public Integer getSingles(){
		return this.hits-this.homers-this.triples-this.doubles;
	}
	public Double getObp(){
		return (double)(this.hits+this.walks+this.hitBatters)/(this.atBats+this.walks+this.hitBatters+this.sacFlies);
	}
	public Double getSlg(){
		return (double)(this.getSingles()+this.doubles*2+this.triples*3+this.homers*4)/this.atBats;
	}
	public Double getOps(){
		return this.getObp()+this.getSlg();
	}
	public Double getKpct(){
		return (double)this.strikes/this.pitches;
	}
	public Double getGpct(){
		return (double)this.groundBalls/(this.groundBalls+this.airBalls);
	}

	public void setNumGamesDuringTrailingDays(Integer numGamesDuringTrailingDays) {
		this.numGamesDuringTrailingDays = numGamesDuringTrailingDays;
	}

	public Integer getNumGamesDuringTrailingDays() {
		return numGamesDuringTrailingDays;
	}

	public void computeMASZ(double[] arrK, double[] arrGb, double[] arrOps) {
		if(this.numGames==0){
			return;
		}else{
			computeS(arrK, arrGb, arrOps);
			computeZ();
		}
	}
	public void computeS(double[] arrKpctDayMarks, double[] arrGpctDayMarks,
			double[] arrOpsDayMarks){
		/* setting MA's in Servlet->fetchAndCompute(). true percentages rather than average of day averages*/
	    this.kpctS = new Double(new StandardDeviation().evaluate(arrKpctDayMarks));
	    this.gpctS = new Double(new StandardDeviation().evaluate(arrGpctDayMarks));
	    this.opsS = new Double(new StandardDeviation().evaluate(arrOpsDayMarks));
	}
	
	public void computeZ(){
		// strike pct z-score
		this.kpctZ = new Double((this.getKpct()-this.kpctMA)/this.kpctS);
		
		// grounder pct z-score
		this.gpctZ = new Double((this.getGpct()-this.gpctMA)/this.gpctS);
		
		// OPS z-score
		this.opsZ = new Double((this.getOps()-this.opsMA)/this.opsS);
	}

	public boolean sValuesNotNull() {
		if(this.opsS != null &&
				this.gpctS != null &&
				this.kpctS != null){
			return true;
		}else{ 
			return false;
		}
	}
	public boolean zValuesNotNull(){
		if(this.opsZ != null &&
				this.gpctZ != null &&
				this.kpctZ != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	

	
	
	
}
