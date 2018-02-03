package triad;

import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.datastore.Text;
import com.google.appengine.api.users.User;

import java.util.List;
import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
//import javax.jdo.annotations.Element;
import javax.jdo.annotations.PrimaryKey;

@PersistenceCapable
public class League {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private String name;
	@Persistent
	private String password;
	@Persistent
	private List<User> users;
	
	@Persistent(mappedBy = "league")
	private List<Venue> venues;
	
	@Persistent(mappedBy = "league")
	private List<Player> players;
	
	@Persistent(mappedBy = "league")
	private List<Season> seasons;
	
	@Persistent(mappedBy = "league")
	private List<LeagueLogin> logins;
	
	@Persistent
	private Text specifications;
	@Persistent
	private String engineClass;
	@Persistent
	private Integer numberOfPlayers;
	@Persistent
	private Integer numberOfTotalRacers;
	@Persistent
	private Integer racesPerCluster;
	@Persistent
	private Integer lapsPerRace;
	@Persistent
	private String itemsSetting;
	@Persistent
	private String[] courses;
	@Persistent
	private Integer[] winPointValues;
	@Persistent
	private User owner;
	public static final String[] MUSHROOM_CUP = new String[]{
		"Luigi Circuit",
		"Peach Beach",
		"Baby Park",
		"Dry Dry Desert"
	};
	public static final String[] FLOWER_CUP = new String[]{
		"Mushroom Bridge",
		"Mario Circuit",
		"Daisy Cruiser",
		"Waluigi Stadium"
	};
	public static final String[] STAR_CUP = new String[]{
		"Sherbet Land",
		"Mushroom City",
		"Yoshi Circuit",
		"DK Mountain"
	};
	public static final String[] SPECIAL_CUP = new String[]{
		"Wario Colosseum",
		"Dino Dino Jungle",
		"Bowser Castle",
		"Rainbow Road"
	};
	public static final String[][] CUPS = new String[][]{
		MUSHROOM_CUP,
		FLOWER_CUP,
		STAR_CUP,
		SPECIAL_CUP
	};
	public static final String[] DRIVERS = new String[]{
		"Baby Mario",
		"Baby Luigi",
		"Koopa",
		"Paratroopa",
		"Diddy Kong",
		"Bowser Jr.",
		"Toad",
		"Toadette",
		"Mario",
		"Luigi",
		"Peach",
		"Daisy",
		"Yoshi",
		"Birdo",
		"Waluigi",
		"Bowser",
		"Donkey Kong",
		"Wario",
		"Petey Pirahna",
		"King Boo"
		
	};
	public static final String[] KARTS = new String[]{
		"Goo-Goo Buggy",
		"Rattle Buggy",
		"Koopa Dasher",
		"Para Wing",
		"Barrel Train",
		"Bullet Blaster",
		"Toad Kart",
		"Toadette Kart",
		"Red Fire",
		"Green Fire",
		"Heart Coach",
		"Bloom Coach",
		"Turbo Yoshi",
		"Turbo Birdo",
		"Waluigi Racer",
		"Wario Car",
		"DK Jumbo",
		"Koopa King",
		"Piranha Pipes",
		"Boo Pipes",
		"Parade Kart"
	};
	
	public League(){}
	public League(String name, String password, Text specifications,
			String engineClass, Integer numberOfPlayers,
			Integer numberOfTotalRacers, Integer racesPerCluster,
			Integer lapsPerRace, String itemsSetting, String[] courses, User owner, Integer[] winPointValues) {
		this.name = name;
		this.password = password;
		this.specifications = specifications;
		this.engineClass = engineClass;
		this.numberOfPlayers = numberOfPlayers;
		this.numberOfTotalRacers = numberOfTotalRacers;
		this.racesPerCluster = racesPerCluster;
		this.lapsPerRace = lapsPerRace;
		this.itemsSetting = itemsSetting;
		this.courses = courses;
		this.owner = owner;
		this.winPointValues = winPointValues;
	}


	public Key getKey(){
		return key;
	}
	public String getName(){
		return name;
	}
	public String getPassword(){
		return password;
	}
	public List<User> getUsers(){
		return users;
	}
	public List<Venue> getVenues() {
		return venues;
	}
	public List<Player> getPlayers(){
		return players;
	}
	public List<LeagueLogin> getLogins(){
		return logins;
	}
	
	public Text getSpecifications() {
		return specifications;
	}
	public Boolean isOfficial() {
		// league is official if there is a Cluster race limit
		return (this.racesPerCluster > 0);
	}
	public String getEngineClass() {
		return engineClass;
	}
	public Integer getNumberOfPlayers() {
		return numberOfPlayers;
	}
	public Integer getNumberOfTotalRacers() {
		return numberOfTotalRacers;
	}
	public Integer getRacesPerCluster() {
		return racesPerCluster;
	}
	public Integer getLapsPerRace() {
		return lapsPerRace;
	}
	public String getItemsSetting() {
		return itemsSetting;
	}
	public String[] getCourses() {
		return courses;
	}
	public List<Season> getSeasons() {
		return seasons;
	}
	public Boolean hasBots(){
		return (this.getNumberOfPlayers()<this.getNumberOfTotalRacers());
	}
	
	public User getOwner() {
		return owner;
	}
	
	public Integer[] getWinPointValues() {
		return winPointValues;
	}
	public Integer getWinPointValue(Integer finish){
		return this.winPointValues[finish];
	}
	public void setWinPointValues(Integer[] winPointMap) {
		this.winPointValues = winPointMap;
	}
	public void setOwner(User owner) {
		this.owner = owner;
	}
	public void setSpecifications(Text specifications) {
		this.specifications = specifications;
	}
	public void setEngineClass(String engineClass) {
		this.engineClass = engineClass;
	}
	public void setNumberOfPlayers(Integer numberOfPlayers) {
		this.numberOfPlayers = numberOfPlayers;
	}
	public void setNumberOfTotalRacers(Integer numberOfTotalRacers) {
		this.numberOfTotalRacers = numberOfTotalRacers;
	}
	public void setRacesPerCluster(Integer racesPerCluster) {
		this.racesPerCluster = racesPerCluster;
	}
	public void setLapsPerRace(Integer lapsPerRace) {
		this.lapsPerRace = lapsPerRace;
	}
	public void setItemsSetting(String itemsSetting) {
		this.itemsSetting = itemsSetting;
	}
	public void setCourses(String[] courses) {
		this.courses = courses;
	}
	public void setName(String name){
		this.name = name;
	}
	public void setPassword(String password){
		this.password = password;
	}

	public void addVenue(Venue venue){
		this.venues.add(venue);
	}
	public void addPlayer(Player player){
		this.players.add(player);
	}
	public void addUser(User user){
		this.users.add(user);
	}
	public void addSeason(Season season){
		this.seasons.add(season);
	}
	public void addLogin(LeagueLogin login){
		this.logins.add(login);
	}
	
	public boolean removeUser(User user){
		return users.remove(user);
	}
	public boolean checkUserIsMember(User user){
		if(this.owner.compareTo(user)==0){
			return true;
		}
		for(User u : this.users){
			if (u.compareTo(user)==0){
				return true;
			}
		}
		return false;
	}
	public static Integer[] computeNewWinPointArray(Integer numTotalRacers,
			int numPlayers) {
		Integer[] winPointValues = new Integer[numTotalRacers]; 
		if(numTotalRacers==8 && numPlayers==2){
			winPointValues[0] = 10;
			winPointValues[1] = 8;
			winPointValues[2] = 6;
			winPointValues[3] = 4;
			for(int i=4;i<numTotalRacers;i++){
				winPointValues[i] = numTotalRacers-(i+1);
			}
		}else{
			for(int i=0;i<numTotalRacers;i++){
				winPointValues[i] = numTotalRacers-i;
			}
		}
		return winPointValues;
	}
	
}