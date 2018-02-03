package triad;

import com.google.appengine.api.datastore.Key;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

@PersistenceCapable
public class Player {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private League league;
	@Persistent
	private String name;
	
	public Player(Key key, League league, String name) {
		this.key = key;
		this.league = league;
		this.name = name;
	}
	public Player(League league, String name) {
		this.league = league;
		this.name = name;
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
	public String getShortName(){
		return name.substring(0, (name.length()>=3)?3:name.length());
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
	
	
	
	
}
