package triad;
import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.users.User;
import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;
import java.util.Date;

@PersistenceCapable
public class LeagueLogin {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private League league;
	@Persistent
	private User user;
	@Persistent
	private Date date;
	public LeagueLogin(League league, User user, Date date) {
		this.league = league;
		this.user = user;
		this.date = date;
	}
	public Key getKey() {
		return key;
	}
	public League getLeague() {
		return league;
	}
	public User getUser() {
		return user;
	}
	public Date getDate() {
		return date;
	}
	public void setLeague(League league) {
		this.league = league;
	}
	public void setUser(User user) {
		this.user = user;
	}



}

