package triad;

import com.google.appengine.api.datastore.Key;
import javax.jdo.PersistenceManager;
import java.util.Map;
import java.util.HashMap;

public class Standing implements Comparable<Standing>, java.io.Serializable 
{
	/**
	 * 
	 */
	private static final long serialVersionUID = 1L;
	private Key player;
	private Player playerObject;
	private Integer matchesPlayed;
	private Integer winPoints;
	private int[] finishesByPlace;
	//[0]=matches played, [1]=gap points
	private Map<Key, Integer[]> gapScores;
	
	public Standing(Key player, Integer matchesPlayed, Integer winPoints, Integer possibleFinishPositions, Integer humanRacers) {
		this.player = player;
		this.matchesPlayed = matchesPlayed;
		this.winPoints = winPoints;
		this.finishesByPlace = new int[possibleFinishPositions+1];
		this.gapScores = new HashMap<Key, Integer[]>(humanRacers);
	}
	public void incrementMatchCount(){
		this.matchesPlayed++;
	}
	public void incrementFinishCount(int finish){
		this.finishesByPlace[finish-1]++;
	}
	public void updateWinPoints(Integer newPoints){
		this.winPoints += newPoints;
	}
	public void updateGapScore(Key opponent, Integer relativeFinish){
		if(!this.gapScores.containsKey(opponent)){
			//no existing gapscore for opponent, initialize
			Integer[] newArray = {0,0};
			this.gapScores.put(opponent, newArray);
		}
		Integer[] updatedGapScore = this.gapScores.get(opponent);
		updatedGapScore[0]++;//match count
		updatedGapScore[1]+=relativeFinish;//gap score
		this.gapScores.put(opponent, updatedGapScore);
	}
	
	public Key getPlayerKey() {
		return player;
	}
	public Player getPlayerObject(){
		if(this.playerObject==null){
			PersistenceManager pm = PMF.get().getPersistenceManager();
			this.playerObject = pm.getObjectById(Player.class, player);
			pm.close();
		}
		return this.playerObject;
	}
	public String getPlayerShortName(){
		return getPlayerObject().getShortName();
	}
	public Integer getMatchesPlayed() {
		return matchesPlayed;
	}
	public Integer getWinPoints() {
		return winPoints;
	}
	public int[] getFinishesByPlace(){
		return finishesByPlace;
	}
	public Map<Key, Integer[]> getGapScores(){
		return this.gapScores;
	}
	public void setPlayer(Key player) {
		this.player = player;
	}
	public void setMatchesPlayed(Integer matchesPlayed) {
		this.matchesPlayed = matchesPlayed;
	}
	public void setFinishesByPlace(int[] finishes){
		this.finishesByPlace = finishes;
	}
	public void setWinPoints(Integer winPoints) {
		this.winPoints = winPoints;
	}
	// less than, THIS object is less than outside object
	public int compareTo(Standing s){
		if(s.getWinPoints()==winPoints){
			if(this.gapScores.containsKey(s.getPlayerKey())){
				// return gapscore if players have faced eachother
				// neg means this.player trails s.player
				if(this.gapScores.get(s.getPlayerKey())[1]!=0){
					return this.gapScores.get(s.getPlayerKey())[1];
				}
			}else{
				//haven't played head to head, return who has played most total matches
				return s.getMatchesPlayed()-matchesPlayed;
			}
		}
		return s.getWinPoints()-winPoints;
	}
}
