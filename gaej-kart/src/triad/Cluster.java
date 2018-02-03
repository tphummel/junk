package triad;

import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.users.User;

import java.util.Collections;
import net.sf.jsr107cache.Cache;
import net.sf.jsr107cache.CacheException;
import net.sf.jsr107cache.CacheManager;
import java.util.Map;
import java.util.HashMap;
import com.google.appengine.api.memcache.stdimpl.GCacheFactory;
import com.google.appengine.api.memcache.MemcacheService;

import java.util.List;
import java.util.ArrayList;
import java.util.Date;
//import java.util.Calendar;
//import java.util.Locale;
//import java.util.TimeZone;

//import javax.jdo.annotations.Element;
import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;
import javax.jdo.PersistenceManager;

/*
 * Cluster (n.): A collection of sequenced races which is part of a season within a league, 
 * contested by an immutable number of controllers (2,3,4). 
 * A potentially unlimited number of humans can participate in a single cluster. 
 * 
 * Once a cluster has an associated race, all prior clusters are closed and may no longer accept any changes.
 */

@PersistenceCapable
public class Cluster {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Season season;
	@Persistent
	private Key venue;
	@Persistent
	private Date startDate;
	@Persistent
	private Integer seq;
	@Persistent
	private Boolean activeFlag;
	@Persistent(mappedBy = "cluster")
	private List<Match> matches;
	public Cluster(){}
	public Cluster(Season season, Key venue, Date startDate, Integer seq) {
		this.season = season;
		this.venue = venue;
		this.startDate = startDate;
		this.seq = seq;
		this.activeFlag = true;
	}
	public Key getKey() {
		return key;
	}
	public Season getSeason() {
		/*if(this.season==null){
			PersistenceManager pm = PMF.get().getPersistenceManager();
			this.season = pm.getObjectById(Season.class, new KeyFactory.Builder());
			pm.close();
			
		}*/
		return this.season;
	}
	public League getLeague(){
		return this.season.getLeague();
	}
	
	public Key getVenueKey() {
		return venue;
	}
	public Venue getVenueObject(){
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Venue v = pm.getObjectById(Venue.class, venue);
		pm.close();
		return v;
	}
	public Date getStartDate() {
		return startDate;
	}
	public Integer getSeq() {
		return seq;
	}
	public List<Match> getMatches() {
		return matches;
	}
	public Integer getMatchCount(){
		return matches.size();
	}
	
	public Boolean getActiveFlag() {
		return activeFlag;
	}
	public void setKey(Key key) {
		this.key = key;
	}
	public void setSeason(Season season) {
		this.season = season;
	}
	public void setVenue(Key venue) {
		this.venue = venue;
	}
	public void setStartDate(Date startDate) {
		this.startDate = startDate;
	}
	public void setSeq(Integer seq) {
		this.seq = seq;
	}
	public void addMatch(Match match) throws Exception{
		if(!this.activeFlag){
			throw new Exception("Can't Add Match to a Completed Cluster");
		}else if(this.season.getRacesPerCluster()>0 && this.getNumberOfMatchesRemaining()==0){
			throw new Exception("Cluster has reached its limit but was still flagged active. Attempted to add a match. How?");
		}
		this.matches.add(match);
		/*
		List<Standing> standings = this.memCacheGetStandings();
		if(standings == null){
			standings = this.computeStandings();
		}else{
			standings = this.addNewMatchToStandings(standings, match);
		}
		this.memCachePutStandings(standings);
		*/
		if(this.getNumberOfMatchesRemaining()==0){
			this.activeFlag = false;
		}
		
	}
	public void removeMatch(Match match) throws Exception{
		if(this.matches.contains(match)){
			this.matches.remove(match);
			if(!this.activeFlag){
				this.activeFlag = true;
			}
		}else{
			throw new Exception("Match is not contained in Cluster. Cannot remove.");
		}
		
	}
	public Integer getNumberOfMatchesRemaining(){
		if(this.season.getRacesPerCluster()!=0){
			return this.season.getRacesPerCluster()-this.matches.size(); 
		}else{
			return -99999;
		}
	}
	public String[] getLeagueCourses(){
		return this.season.getLeagueCourses();
	}
	public List<Player> getLeaguePlayers(){
		return this.season.getLeaguePlayers();
	}
	public Boolean checkIsLeagueOfficial(){
		return this.season.checkIsLeagueOfficial();
	}
	public Boolean checkUserIsLeagueMember(User user){
		return this.season.checkUserIsLeagueMember(user);
	}
	public Boolean checkSeasonHasMatches(){
		return this.season.hasMatches();
	}
	public Boolean checkLeagueHasBots(){
		return this.season.checkLeagueHasBots();
	}
	public Integer getNumberOfRacersPerMatch(){
		return this.season.lookupLeagueRacersPerMatch();
	}
	public Integer getNumberOfPlayersPerRace(){
		return this.season.lookupLeaguePlayersPerMatch();
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
		
		for(Match m : this.matches){
			this.addNewMatchToStandings(standings, m);
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
					s.updateWinPoints(this.season.lookupWinPointValue(p.getFinishPos()));
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
						this.season.lookupLeagueRacersPerMatch(),//possible finish positions
						this.season.lookupLeaguePlayersPerMatch()); //humans per race
				standing.incrementMatchCount();
				standing.incrementFinishCount(p.getFinishPos());
				standing.updateWinPoints(season.lookupWinPointValue(p.getFinishPos()));
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
	/*private void memCachePutStandings(List<Standing> standings){
		Cache cache;
		
		Map props = new HashMap();
        props.put(GCacheFactory.EXPIRATION_DELTA, 3600);
        props.put(MemcacheService.SetPolicy.SET_ALWAYS, true);
		
        try {
            cache = CacheManager.getInstance().getCacheFactory().createCache(props);
            for(Standing s : standings){
            	cache.put(s.getPlayerKey(), s);
            }
        } catch (CacheException e) {}
	}
	private List<Standing> memCacheGetStandings(){
		Cache cache;
		List<Standing> standings = new ArrayList<Standing>();
		
		Map props = new HashMap();
        props.put(GCacheFactory.EXPIRATION_DELTA, 3600);
        props.put(MemcacheService.SetPolicy.SET_ALWAYS, true);
		
        try {
            cache = CacheManager.getInstance().getCacheFactory().createCache(props);
            if(!cache.containsKey(this.key)){
            	return null;
            }
            */
            
            /*Standing[] arrStandings = (Standing[]) cache.get(this.key);
            for(Standing s : arrStandings){
            	standings.add(s);
            }*/
            //standings = (List<Standing>)cache.get(this.key);
            
            //cache.put(this.key, standings);
        /*} catch (CacheException e) {
        	return null;
        }
        
        return standings;
	}*/
	
}
