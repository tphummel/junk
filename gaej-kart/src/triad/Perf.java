package triad;

import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.datastore.KeyFactory;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;
import javax.jdo.PersistenceManager;

@PersistenceCapable
public class Perf implements Comparable<Perf> {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Match match;
	@Persistent
	private Key player;
	@Persistent
	private String[] drivers;
	@Persistent
	private String kart;
	@Persistent
	private Integer finishPos;
	public Perf(){}
	public Perf(Match match, Key player, String[] drivers, String kart,
			Integer finishPos) throws MatchException {
		
		/*if(player==null){
			throw new MatchException("null player key value passed into Perf constructor");
		}*/
		
		this.match = match;
		this.player = player;
		this.drivers = drivers;
		this.kart = kart;
		this.finishPos = finishPos;
	}
	public Perf(Match match, String player, String[] drivers, String kart,
			Integer finishPos) throws MatchException{
		
		if(player.equals("-1")){
			throw new MatchException("-1 player key value passed into Perf constructor");
		}
		this.match = match;
		this.player = KeyFactory.stringToKey(player);
		this.drivers = drivers;
		this.kart = kart;
		this.finishPos = finishPos;
	}
	public Key getKey(){
		return key;
	}
	public Match getMatch() {
		return match;
	}
	public Key getPlayerKey() {
		return player;
	}
	public Player getPlayerObject(){
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Player p = pm.getObjectById(Player.class, player);
		pm.close();
		return p;
	}
	public String getShortPlayerName(){
		return getPlayerObject().getShortName();
	}
	public String[] getDrivers() {
		return drivers;
	}
	public String getKart() {
		return kart;
	}
	public Integer getFinishPos() {
		return finishPos;
	}
	public void setMatch(Match match) {
		this.match = match;
	}
	public void setPlayer(Key player) {
		this.player = player;
	}
	public void setDrivers(String[] drivers) {
		this.drivers = drivers;
	}
	public void setKart(String kart) {
		this.kart = kart;
	}
	public void setFinishPos(Integer finishPos) {
		this.finishPos = finishPos;
	}
	public int compareTo(Perf p){
		return finishPos-p.getFinishPos();
	}
	
}
