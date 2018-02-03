package basketball;

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
public class BasketballDay {
	public static final String actionCategory1 = "Scoring";
	public static final String actionCategory2 = "Free Throws";
	public static final String actionCategory3 = "Rebounding";

	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Key seasonId;
	@Persistent
	private Date date;
	@Persistent
	private Integer numGames = 0;
	@Persistent
	private Integer homeWins = 0;
	@Persistent
	private Integer awayWins = 0;
	@Persistent
	private Integer totalPoints = 0;
	@Persistent
	private Integer homePoints = 0;
	@Persistent
	private Integer awayPoints = 0;
	@Persistent
	private Integer combOrebs = 0;
	@Persistent
	private Integer combTrebs = 0;
	
	@Persistent
	private Integer combAst = 0;
	@Persistent
	private Integer combStl = 0;
	@Persistent
	private Integer combBlk = 0;
	@Persistent
	private Integer combTO = 0;
	@Persistent
	private Integer combPF = 0;
	@Persistent
	private Integer combFgm = 0;
	@Persistent
	private Integer combFga = 0;
	
	@Persistent
	private Integer combFtm = 0;
	@Persistent
	private Integer combFta = 0;
	@Persistent
	private Integer combTpm = 0;
	@Persistent
	private Integer combTpa = 0;
	
	@Persistent
	private Double ppgMA = null;
	@Persistent
	private Double ppgS = null;
	@Persistent
	private Double ppgZ = null;
	@Persistent
	private Double ftPctMA = null;
	@Persistent
	private Double ftPctS = null;
	@Persistent
	private Double ftPctZ = null;
	@Persistent
	private Double orebPctMA = null;
	@Persistent
	private Double orebPctS = null;
	@Persistent
	private Double orebPctZ = null;

	public BasketballDay() {
		super();
	}

	// iterate over day's games. sum day results columns. don't change anything we set at init this morning
	public void sumDaysGames(ArrayList<BasketballGame> games){
		//System.out.println("in sumdaysgames");
		this.homeWins = 0;
		this.awayWins = 0;
		this.totalPoints = 0;
		this.homePoints = 0;
		this.awayPoints = 0;
		this.combOrebs = 0;
		this.combTrebs = 0;
		this.combAst = 0;
		this.combFgm = 0;
		this.combFga = 0;
		this.combFtm = 0;
		this.combFta = 0;
		this.combTpa = 0;
		this.combTpm = 0;
		this.combStl = 0;
		this.combBlk = 0;
		this.combTO = 0;
		this.combPF = 0;
		
		for(BasketballGame game : games){
			//System.out.println(game.toString());
			this.homePoints += game.getHomeScore();
			this.awayPoints += game.getAwayScore();
			this.totalPoints += (game.getHomeScore()+game.getAwayScore());
			
			this.combOrebs += game.getAwayOreb()+game.getHomeOreb();
			this.combTrebs += game.getAwayOreb()+game.getHomeOreb()+game.getAwayDreb()+game.getHomeDreb();
			this.combAst += game.getAwayAst()+game.getHomeAst();
			this.combStl += game.getAwayStl()+game.getHomeStl();
			this.combBlk += game.getAwayBlk()+game.getHomeBlk();
			this.combPF += game.getAwayPF()+game.getHomePF();
			this.combTO += game.getAwayTO()+game.getHomeTO();
			this.combFgm += game.getAwayFGM()+game.getHomeFGM();
			this.combFga += game.getAwayFGA()+game.getHomeFGA();
			this.combFtm += game.getAwayFTM()+game.getHomeFTM();
			this.combFta += game.getAwayFTA()+game.getHomeFTA();
			this.combTpa += game.getAwayTPA()+game.getHomeTPA();
			this.combTpm += game.getAwayTPM()+game.getHomeTPM();
			
			if(game.getAwayScore() > game.getHomeScore()){
				this.awayWins++;
			}else if(game.getAwayScore() < game.getHomeScore()){
				this.homeWins++;
			}
		}
	}

	public Key getKey() {
		return key;
	}

	public void setKey(Key key) {
		this.key = key;
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

	public Integer getHomeWins() {
		return homeWins;
	}

	public void setHomeWins(Integer homeWins) {
		this.homeWins = homeWins;
	}

	public Integer getAwayWins() {
		return awayWins;
	}

	public void setAwayWins(Integer awayWins) {
		this.awayWins = awayWins;
	}

	public Integer getTotalPoints() {
		return totalPoints;
	}

	public void setTotalPoints(Integer totalPoints) {
		this.totalPoints = totalPoints;
	}

	public Integer getHomePoints() {
		return homePoints;
	}

	public void setHomePoints(Integer homePoints) {
		this.homePoints = homePoints;
	}

	public Integer getAwayPoints() {
		return awayPoints;
	}

	public void setAwayPoints(Integer awayPoints) {
		this.awayPoints = awayPoints;
	}

	public Integer getCombOrebs() {
		return combOrebs;
	}

	public void setCombOrebs(Integer combOrebs) {
		this.combOrebs = combOrebs;
	}

	public Integer getCombTrebs() {
		return combTrebs;
	}

	public void setCombTrebs(Integer combTrebs) {
		this.combTrebs = combTrebs;
	}

	public Integer getCombAst() {
		return combAst;
	}

	public void setCombAst(Integer combAst) {
		this.combAst = combAst;
	}

	public Integer getCombFgm() {
		return combFgm;
	}

	public void setCombFgm(Integer combFgm) {
		this.combFgm = combFgm;
	}

	public Integer getCombFga() {
		return combFga;
	}

	public void setCombFga(Integer combFga) {
		this.combFga = combFga;
	}

	public Integer getCombFtm() {
		return combFtm;
	}

	public void setCombFtm(Integer combFtm) {
		this.combFtm = combFtm;
	}

	public Integer getCombFta() {
		return combFta;
	}

	public void setCombFta(Integer combFta) {
		this.combFta = combFta;
	}

	public Integer getCombTpm() {
		return combTpm;
	}

	public void setCombTpm(Integer combTpm) {
		this.combTpm = combTpm;
	}

	public Integer getCombTpa() {
		return combTpa;
	}

	public void setCombTpa(Integer combTpa) {
		this.combTpa = combTpa;
	}

	public Double getPpgMA() {
		return ppgMA;
	}

	public void setPpgMA(Double ppgMA) {
		this.ppgMA = ppgMA;
	}

	public Double getPpgS() {
		return ppgS;
	}

	public void setPpgS(Double ppgS) {
		this.ppgS = ppgS;
	}

	public Double getPpgZ() {
		return ppgZ;
	}

	public void setPpgZ(Double ppgZ) {
		this.ppgZ = ppgZ;
	}

	public Double getFtPctMA() {
		return ftPctMA;
	}

	public void setFtPctMA(Double ftPctMA) {
		this.ftPctMA = ftPctMA;
	}

	public Double getFtPctS() {
		return ftPctS;
	}

	public void setFtPctS(Double ftPctS) {
		this.ftPctS = ftPctS;
	}

	public Double getFtPctZ() {
		return ftPctZ;
	}

	public void setFtPctZ(Double ftPctZ) {
		this.ftPctZ = ftPctZ;
	}

	public Double getOrebPctMA() {
		return orebPctMA;
	}

	public void setOrebPctMA(Double orebPctMA) {
		this.orebPctMA = orebPctMA;
	}

	public Double getOrebPctS() {
		return orebPctS;
	}

	public void setOrebPctS(Double orebPctS) {
		this.orebPctS = orebPctS;
	}

	public Double getOrebPctZ() {
		return orebPctZ;
	}

	public void setOrebPctZ(Double orebPctZ) {
		this.orebPctZ = orebPctZ;
	}
	
	public Integer getCombStl() {
		return combStl;
	}

	public void setCombStl(Integer combStl) {
		this.combStl = combStl;
	}

	public Integer getCombBlk() {
		return combBlk;
	}

	public void setCombBlk(Integer combBlk) {
		this.combBlk = combBlk;
	}

	public Integer getCombTO() {
		return combTO;
	}

	public void setCombTO(Integer combTO) {
		this.combTO = combTO;
	}

	public Integer getCombPF() {
		return combPF;
	}

	public void setCombPF(Integer combPF) {
		this.combPF = combPF;
	}

	public Key getSeasonId() {
		return seasonId;
	}

	public void setSeasonId(Key seasonId) {
		this.seasonId = seasonId;
	}

	public void computeMASZ(double[] arrPpg, double[] arrFt, double[] arrOreb) {
		if(this.numGames==0){
			return;
		}else{
			computeS(arrPpg, arrFt, arrOreb);
			computeZ();
		}
	}
	public void computeS(double[] arrPpgDayMarks, double[] arrFtDayMarks,
			double[] arrOrebDayMarks){
		/* setting MA's in Servlet->fetchAndCompute(). true percentages rather than average of day averages*/
		//this.ppgMA = new Double(StatUtils.mean(arrPpg));
	    this.ppgS = new Double(new StandardDeviation().evaluate(arrPpgDayMarks));
	    //this.ftPctMA = new Double(StatUtils.mean(arrFt));
	    this.ftPctS = new Double(new StandardDeviation().evaluate(arrFtDayMarks));
	    //this.orebPctMA = new Double(StatUtils.mean(arrOreb));
	    this.orebPctS = new Double(new StandardDeviation().evaluate(arrOrebDayMarks));
	}
	
	public void computeZ(){
		// total ppg z-score
		this.ppgZ = new Double((((double)this.totalPoints/this.numGames)-this.ppgMA)/this.ppgS);
		
		// ft pct ppg z-score
		System.out.println("ftpct: "+this.combFtm/this.combFta);
		this.ftPctZ = new Double((((double)this.combFtm/this.combFta)-this.ftPctMA)/this.ftPctS);
		
		// oreb pct z-score
		System.out.println("orebpct: "+this.combOrebs/this.combTrebs);
		this.orebPctZ = new Double((((double)this.combOrebs/this.combTrebs)-this.orebPctMA)/this.orebPctS);
		System.out.println("oreb z-score: " + this.toString());
	}

	
	
	@Override
	public String toString() {
		return "BasketballDay [key=" + key + ", date=" + date + ", numGames="
				+ numGames + ", homeWins=" + homeWins + ", awayWins="
				+ awayWins + ", totalPoints=" + totalPoints + ", homePoints="
				+ homePoints + ", awayPoints=" + awayPoints + ", combOrebs="
				+ combOrebs + ", combTrebs=" + combTrebs + ", combAst="
				+ combAst + ", combFgm=" + combFgm + ", combFga=" + combFga
				+ ", combFtm=" + combFtm + ", combFta=" + combFta
				+ ", combTpm=" + combTpm + ", combTpa=" + combTpa + ", ppgMA="
				+ ppgMA + ", ppgS=" + ppgS + ", ppgZ=" + ppgZ + ", ftPctMA="
				+ ftPctMA + ", ftPctS=" + ftPctS + ", ftPctZ=" + ftPctZ
				+ ", orebPctMA=" + orebPctMA + ", orebPctS=" + orebPctS
				+ ", orebPctZ=" + orebPctZ + "]";
	}

	public boolean sValuesNotNull() {
		if(this.orebPctS != null &&
				this.ftPctS != null &&
				this.ppgS != null){
			return true;
		}else{ 
			return false;
		}
	}
	public boolean zValuesNotNull(){
		if(this.orebPctZ != null &&
				this.ftPctZ != null &&
				this.ppgZ != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	

	
	
	
}
