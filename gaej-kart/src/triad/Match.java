package triad;

import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.datastore.Text;
import java.util.List;
import java.util.ArrayList;
import java.util.Date;

//import javax.jdo.annotations.Element;
import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

@PersistenceCapable
public class Match {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Cluster cluster;
	@Persistent
	private Date submitDate;
	@Persistent
	private Integer seq;
	@Persistent
	private String course;
	@Persistent
	private String notes;
	@Persistent(mappedBy = "match")
	private List<Perf> perfs;
	public Match(){
		// filling form from prev match checks if perfs isEmpty()
		this.perfs = new ArrayList<Perf>();
	}
	public Match(Cluster cluster, Date submitDate, Integer seq, String course, String notes) {
		this.cluster = cluster;
		this.submitDate = submitDate;
		this.seq = seq;
		this.course = course;
		this.notes = notes;
		this.perfs = new ArrayList<Perf>();
	}
	public Key getKey() {
		return key;
	}
	public Cluster getCluster() {
		return cluster;
	}
	public Date getSubmitDate() {
		return submitDate;
	}
	public Integer getSeq() {
		return seq;
	}
	public String getCourse() {
		return course;
	}
	public String getNotes(){
		return notes;
	}
	public List<Perf> getPerfs() {
		return perfs;
	}
	public void setKey(Key key) {
		this.key = key;
	}
	public void setCluster(Cluster cluster) {
		this.cluster = cluster;
	}
	public void setSubmitDate(Date submitDate) {
		this.submitDate = submitDate;
	}
	public void setSeq(Integer seq) {
		this.seq = seq;
	}
	public void setCourse(String course) {
		this.course = course;
	}
	public void setNotes(String notes){
		this.notes = notes;
	}
	public void addPerf(Perf perf) throws MatchException{
		this.perfs.add(perf);
		this.validateMatch();
	}
	private void validateMatch() throws MatchException {	
		for(int u=0; u<this.getPerfs().size();u++){
			Perf p1 = this.getPerfs().get(u);
			if(p1.getKart().equals("-1")){
				throw new MatchException("forgot to choose Kart");
			}
			if(p1.getDrivers()[0].equals("-1")){
				throw new MatchException("forgot to choose Driver");
			}
			if(p1.getDrivers()[1].equals("-1")){
				throw new MatchException("forgot to choose Rear");
			}
			if(p1.getFinishPos()==-1){
				throw new MatchException("forgot to choose Finish Pos");
			}
			// same driver in both slots for single player
			if(p1.getDrivers()[0].equals(p1.getDrivers()[1])){
				throw new MatchException("one player using two: "+p1.getDrivers()[0]);
			}
			for(int w=0; w<this.getPerfs().size();w++){
				Perf p2 = this.getPerfs().get(w);
				// don't compare perf to itself
				if(u!=w){
					// duplicate drivers
					for(String p1char : p1.getDrivers()){
						for(String p2char : p2.getDrivers()){
							if(p1char.equals(p2char)){
								throw new MatchException("two players using: "+p2char);
							}
						}
					}
					// duplicate players
					if(p1.getPlayerKey().compareTo(p2.getPlayerKey())==0){
						throw new MatchException("duplicate players");
					}
					// duplicate finish positions
					if(p1.getFinishPos()==p2.getFinishPos()){
						throw new MatchException("duplicate finish positions");
					}
				}
			}
		}
	}
	public void clearPerfs() {
		this.perfs.clear();
	}
}
