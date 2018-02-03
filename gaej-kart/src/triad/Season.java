package triad;

import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.users.User;

import java.util.Map;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
//import java.util.Map;
//import javax.jdo.annotations.Element;
import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

@PersistenceCapable
public class Season {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private League league;
	@Persistent
	private String name;
	@Persistent
	private Integer seq;
	@Persistent(mappedBy = "season")
	private List<Cluster> clusters;
	public Season(){}
	public Season(Key key, League league, String name, int seq,
			List<Cluster> clusters) {
		this.key = key;
		this.league = league;
		this.name = name;
		this.seq = seq;
		this.clusters = clusters;
	}
		public Season(League league, String name, Integer seq) {
		this.league = league;
		this.name = name;
		this.seq = seq;
	}
	public Map<String, List<Standing>> getCoursesStandings(){
		Map<String, List<Standing>> coursesStandings = new HashMap<String, List<Standing>>();
		for(String course : this.league.getCourses()){
			List<Standing> standings = new ArrayList<Standing>();
			coursesStandings.put(course, standings);
		}
		for(Cluster c : this.getClusters()){
			for(Match m : c.getMatches()){
				coursesStandings.put(m.getCourse(), addNewMatchToStandings(coursesStandings.get(m.getCourse()), m));
			}
		}
		return coursesStandings;
	}
	public List<Standing> getStandings(){
		List<Standing> standings = new ArrayList<Standing>();
        //standings = this.memCacheGetStandings();
        //if(standings==null || standings.isEmpty()){
        	standings = this.computeStandings();
        //	memCachePutStandings(standings);
        //}
        
		return standings;
	}
	private List<Standing> computeStandings(){
		List<Standing> standings = new ArrayList<Standing>();
		for(Cluster c : this.clusters){
			for(Match m : c.getMatches()){
				this.addNewMatchToStandings(standings, m);
			}
		}
		Collections.sort(standings);
		return standings;
	}
	private List<Standing> addNewMatchToStandings(List<Standing> standings, Match m){
		Boolean standingFound = false;
		for(Perf p : m.getPerfs()){
			for(Standing s : standings){
				if(p.getPlayerKey().compareTo(s.getPlayerKey())==0){
					standingFound = true;
					s.incrementMatchCount();
					s.incrementFinishCount(p.getFinishPos());
					s.updateWinPoints(this.lookupWinPointValue(p.getFinishPos()));
					for(Perf opp : m.getPerfs()){
						if(p.getPlayerKey().compareTo(opp.getPlayerKey())!=0){
							//not p, updating p's standing relative to opp
							s.updateGapScore(opp.getPlayerKey(), p.getFinishPos()-opp.getFinishPos());
						}
					}
				}
			}
			if(!standingFound){
				Standing standing = new Standing(
						p.getPlayerKey(), // player key
						0, //races completed
						0, //win points
						this.lookupLeagueRacersPerMatch(),//possible finish positions
						this.lookupLeaguePlayersPerMatch()); //humans per race
				standing.incrementMatchCount();
				standing.incrementFinishCount(p.getFinishPos());
				standing.updateWinPoints(this.lookupWinPointValue(p.getFinishPos()));
				for(Perf opp : m.getPerfs()){
					if(p.getPlayerKey().compareTo(opp.getPlayerKey())!=0){
						//not p, updating p's standing relative to opp
						//2 positions "below" opp is actually +2 in gap points - 1st vs 3rd place
						standing.updateGapScore(opp.getPlayerKey(), p.getFinishPos()-opp.getFinishPos());
					}
				}
				standings.add(standing);
			}
			standingFound = false;
		}
	return standings;
	}
	
	/*
	public List<Standing> getStandings(){
		List<Standing> standings = new ArrayList<Standing>();
		Boolean standingFound = false;
		for(Cluster c: this.clusters){
			for(Match m : c.getMatches()){
				for(Perf p : m.getPerfs()){
					for(Standing s : standings){
						if(p.getPlayerKey().compareTo(s.getPlayerKey())==0){
							s.incrementMatchCount();
							s.incrementFinishCount(p.getFinishPos());
							s.updateWinPoints(lookupWinPointValue(p.getFinishPos()));
							standingFound = true;
						}
					}
					if(!standingFound){
						Standing standing = new Standing(
								p.getPlayerKey(), 
								1, 
								lookupWinPointValue(p.getFinishPos()), 
								this.lookupLeagueRacersPerMatch(), // tot poss finish pos
								this.lookupLeaguePlayersPerMatch()); // humans per match
						standing.incrementFinishCount(p.getFinishPos());
						standings.add(standing);
					}
					standingFound = false;
				}
			}
		}
		Collections.sort(standings);
		return standings;
	}*/
	public void addCluster(Cluster c){
		this.clusters.add(c);
	}

	public Key getKey() {
		return key;
	}

	public League getLeague() {
		return league;
	}

	public String getName() {
		return name;
	}

	public Integer getSeq() {
		return seq;
	}

	public List<Cluster> getClusters() {
		return clusters;
	}
	
	// facade methods - obscuring higher objects in hierarchy
	public Integer getRacesPerCluster(){
		return this.league.getRacesPerCluster();
	}
	public Boolean checkIsLeagueOfficial(){
		return this.league.isOfficial();
	}
	public Boolean checkLeagueHasBots(){
		return this.league.hasBots();
	}
	public Integer lookupWinPointValue(Integer finish){
		return this.league.getWinPointValue(finish-1);
	}
	public Integer lookupLeagueRacersPerMatch(){
		return this.league.getNumberOfTotalRacers();
	}
	public Integer lookupLeaguePlayersPerMatch(){
		return this.league.getNumberOfPlayers();
	}
	public Boolean hasMatches(){
		for(Cluster c : clusters){
			if(c.getMatchCount()>0){
				return true;
			}
		}
		return false;
	}
	public Boolean checkUserIsLeagueMember(User user){
		return this.league.checkUserIsMember(user);
	}

	public void setKey(Key key) {
		this.key = key;
	}

	public void setLeague(League league) {
		this.league = league;
	}

	public void setName(String name) {
		this.name = name;
	}

	public void setSeq(Integer seq) {
		this.seq = seq;
	}
	public String[] getLeagueCourses() {
		return this.league.getCourses();
	}
	public List<Player> getLeaguePlayers() {
		return this.league.getPlayers();
	}
	public List<Venue> getLeagueVenues(){
		return this.league.getVenues();
	}
	
	
	
	
	
}
