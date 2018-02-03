package basketball;

import java.util.Date;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

import com.google.appengine.api.datastore.Key;

@PersistenceCapable
public class BasketballGame {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Date gameDate;
	@Persistent
	private String awayTeam;
	@Persistent
	private Integer awayScore;
	@Persistent
	private Integer awayFGA;
	@Persistent
	private Integer awayFGM;
	@Persistent
	private Integer awayTPA;
	@Persistent
	private Integer awayTPM;
	@Persistent
	private Integer awayFTA;
	@Persistent
	private Integer awayFTM;
	@Persistent
	private Integer awayOreb;
	@Persistent
	private Integer awayDreb;
	@Persistent
	private Integer awayAst;
	@Persistent
	private Integer awayStl;
	@Persistent
	private Integer awayBlk;
	@Persistent
	private Integer awayTO;
	@Persistent
	private Integer awayPF;
	@Persistent
	private String homeTeam;
	@Persistent
	private Integer homeScore;
	@Persistent
	private Integer homeFGA;
	@Persistent
	private Integer homeFGM;
	@Persistent
	private Integer homeTPA;
	@Persistent
	private Integer homeTPM;
	@Persistent
	private Integer homeFTA;
	@Persistent
	private Integer homeFTM;
	@Persistent
	private Integer homeOreb;
	@Persistent
	private Integer homeDreb;
	@Persistent
	private Integer homeAst;
	@Persistent
	private Integer homeStl;
	@Persistent
	private Integer homeBlk;
	@Persistent
	private Integer homeTO;
	@Persistent
	private Integer homePF;
	@Persistent
	private String headline = null;
	
	public BasketballGame() {
		super();
	}

	public BasketballGame(Key key, Date gameDate, String awayTeam,
			Integer awayScore, String homeTeam, Integer homeScore,
			String headline) {
		super();
		this.key = key;
		this.gameDate = gameDate;
		this.awayTeam = awayTeam;
		this.awayScore = awayScore;
		this.homeTeam = homeTeam;
		this.homeScore = homeScore;
		this.headline = headline;
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

	public String getHeadline() {
		return headline;
	}

	public void setHeadline(String headline) {
		this.headline = headline;
	}
	
	

	public Integer getAwayFGA() {
		return awayFGA;
	}

	public void setAwayFGA(Integer awayFGA) {
		this.awayFGA = awayFGA;
	}

	public Integer getAwayFGM() {
		return awayFGM;
	}

	public void setAwayFGM(Integer awayFGM) {
		this.awayFGM = awayFGM;
	}

	public Integer getAwayTPA() {
		return awayTPA;
	}

	public void setAwayTPA(Integer awayTPA) {
		this.awayTPA = awayTPA;
	}

	public Integer getAwayTPM() {
		return awayTPM;
	}

	public void setAwayTPM(Integer awayTPM) {
		this.awayTPM = awayTPM;
	}

	public Integer getAwayFTA() {
		return awayFTA;
	}

	public void setAwayFTA(Integer awayFTA) {
		this.awayFTA = awayFTA;
	}

	public Integer getAwayFTM() {
		return awayFTM;
	}

	public void setAwayFTM(Integer awayFTM) {
		this.awayFTM = awayFTM;
	}

	public Integer getAwayOreb() {
		return awayOreb;
	}

	public void setAwayOreb(Integer awayOreb) {
		this.awayOreb = awayOreb;
	}

	public Integer getAwayDreb() {
		return awayDreb;
	}

	public void setAwayDreb(Integer awayDreb) {
		this.awayDreb = awayDreb;
	}

	public Integer getAwayStl() {
		return awayStl;
	}

	public void setAwayStl(Integer awayStl) {
		this.awayStl = awayStl;
	}

	public Integer getAwayBlk() {
		return awayBlk;
	}

	public void setAwayBlk(Integer awayBlk) {
		this.awayBlk = awayBlk;
	}

	public Integer getAwayTO() {
		return awayTO;
	}

	public void setAwayTO(Integer awayTO) {
		this.awayTO = awayTO;
	}

	public Integer getHomeFGA() {
		return homeFGA;
	}

	public void setHomeFGA(Integer homeFGA) {
		this.homeFGA = homeFGA;
	}

	public Integer getHomeFGM() {
		return homeFGM;
	}

	public void setHomeFGM(Integer homeFGM) {
		this.homeFGM = homeFGM;
	}

	public Integer getHomeTPA() {
		return homeTPA;
	}

	public void setHomeTPA(Integer homeTPA) {
		this.homeTPA = homeTPA;
	}

	public Integer getHomeTPM() {
		return homeTPM;
	}

	public void setHomeTPM(Integer homeTPM) {
		this.homeTPM = homeTPM;
	}

	public Integer getHomeFTA() {
		return homeFTA;
	}

	public void setHomeFTA(Integer homeFTA) {
		this.homeFTA = homeFTA;
	}

	public Integer getHomeFTM() {
		return homeFTM;
	}

	public void setHomeFTM(Integer homeFTM) {
		this.homeFTM = homeFTM;
	}

	public Integer getHomeOreb() {
		return homeOreb;
	}

	public void setHomeOreb(Integer homeOreb) {
		this.homeOreb = homeOreb;
	}

	public Integer getHomeDreb() {
		return homeDreb;
	}

	public void setHomeDreb(Integer homeDreb) {
		this.homeDreb = homeDreb;
	}

	public Integer getHomeStl() {
		return homeStl;
	}

	public void setHomeStl(Integer homeStl) {
		this.homeStl = homeStl;
	}

	public Integer getHomeBlk() {
		return homeBlk;
	}

	public void setHomeBlk(Integer homeBlk) {
		this.homeBlk = homeBlk;
	}

	public Integer getHomeTO() {
		return homeTO;
	}

	public void setHomeTO(Integer homeTO) {
		this.homeTO = homeTO;
	}
	
	

	public Integer getAwayPF() {
		return awayPF;
	}

	public void setAwayPF(Integer awayPF) {
		this.awayPF = awayPF;
	}

	public Integer getHomePF() {
		return homePF;
	}

	public void setHomePF(Integer homePF) {
		this.homePF = homePF;
	}
	
	public Integer getAwayAst() {
		return awayAst;
	}

	public void setAwayAst(Integer awayAst) {
		this.awayAst = awayAst;
	}

	public Integer getHomeAst() {
		return homeAst;
	}

	public void setHomeAst(Integer homeAst) {
		this.homeAst = homeAst;
	}

	@Override
	public String toString() {
		return "BasketballGame [key=" + key + ", gameDate=" + gameDate
				+ ", awayTeam=" + awayTeam + ", awayScore=" + awayScore
				+ ", awayFGA=" + awayFGA + ", awayFGM=" + awayFGM
				+ ", awayTPA=" + awayTPA + ", awayTPM=" + awayTPM
				+ ", awayFTA=" + awayFTA + ", awayFTM=" + awayFTM
				+ ", awayOreb=" + awayOreb + ", awayDreb=" + awayDreb
				+ ", awayAst=" + awayAst + ", awayStl=" + awayStl
				+ ", awayBlk=" + awayBlk + ", awayTO=" + awayTO + ", awayPF="
				+ awayPF + ", homeTeam=" + homeTeam + ", homeScore="
				+ homeScore + ", homeFGA=" + homeFGA + ", homeFGM=" + homeFGM
				+ ", homeTPA=" + homeTPA + ", homeTPM=" + homeTPM
				+ ", homeFTA=" + homeFTA + ", homeFTM=" + homeFTM
				+ ", homeOreb=" + homeOreb + ", homeDreb=" + homeDreb
				+ ", homeAst=" + homeAst + ", homeStl=" + homeStl
				+ ", homeBlk=" + homeBlk + ", homeTO=" + homeTO + ", homePF="
				+ homePF + ", headline=" + headline + "]";
	}

	

	

	
	
	
	
	
	
	
	
	
	
	
}
