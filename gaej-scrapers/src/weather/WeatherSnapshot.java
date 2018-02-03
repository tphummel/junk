package weather;

import java.util.Date;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;

import org.apache.commons.math.stat.StatUtils;
import org.apache.commons.math.stat.descriptive.moment.StandardDeviation;

import com.google.appengine.api.datastore.Key;

@PersistenceCapable
public class WeatherSnapshot {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private Date date;
	@Persistent
	private Double degreesFarenheit = null;
	@Persistent
	private Double inchesOfMercury = null;
	@Persistent
	private Integer humidityPct = null;
	@Persistent
	private Double temperatureMA = null;
	@Persistent
	private Double temperatureS = null;
	@Persistent
	private Double temperatureZ = null;
	@Persistent
	private Double pressureMA = null;
	@Persistent
	private Double pressureS = null;
	@Persistent
	private Double pressureZ = null;
	@Persistent
	private Double humidityMA = null;
	@Persistent
	private Double humidityS = null;
	@Persistent
	private Double humidityZ = null;
	
	
	public WeatherSnapshot() {
		super();
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

	public Double getTemp() {
		return degreesFarenheit;
	}


	public void setTemp(Double temp) {
		this.degreesFarenheit = temp;
	}


	public Double getPress() {
		return inchesOfMercury;
	}


	public void setPress(Double press) {
		this.inchesOfMercury = press;
	}


	public Double getDegreesFarenheit() {
		return degreesFarenheit;
	}

	public void setDegreesFarenheit(Double degreesFarenheit) {
		this.degreesFarenheit = degreesFarenheit;
	}

	
	
	public Integer getHumid() {
		return humidityPct;
	}


	public void setHumid(Integer humid) {
		this.humidityPct = humid;
	}

	public Double getInchesOfMercury() {
		return inchesOfMercury;
	}

	public void setInchesOfMercury(Double inchesOfMercury) {
		this.inchesOfMercury = inchesOfMercury;
	}

	public Integer getHumidityPct() {
		return humidityPct;
	}

	public void setHumidityPct(Integer humidityPct) {
		this.humidityPct = humidityPct;
	}

	public Double getTemperatureMA() {
		return temperatureMA;
	}

	public void setTemperatureMA(Double temperatureMA) {
		this.temperatureMA = temperatureMA;
	}

	public Double getTemperatureS() {
		return temperatureS;
	}

	public void setTemperatureS(Double temperatureS) {
		this.temperatureS = temperatureS;
	}

	public Double getTemperatureZ() {
		return temperatureZ;
	}

	public void setTemperatureZ(Double temperatureZ) {
		this.temperatureZ = temperatureZ;
	}

	public Double getPressureMA() {
		return pressureMA;
	}

	public void setPressureMA(Double pressureMA) {
		this.pressureMA = pressureMA;
	}

	public Double getPressureS() {
		return pressureS;
	}

	public void setPressureS(Double pressureS) {
		this.pressureS = pressureS;
	}

	public Double getPressureZ() {
		return pressureZ;
	}

	public void setPressureZ(Double pressureZ) {
		this.pressureZ = pressureZ;
	}

	public Double getHumidityMA() {
		return humidityMA;
	}

	public void setHumidityMA(Double humidityMA) {
		this.humidityMA = humidityMA;
	}

	public Double getHumidityS() {
		return humidityS;
	}

	public void setHumidityS(Double humidityS) {
		this.humidityS = humidityS;
	}

	public Double getHumidityZ() {
		return humidityZ;
	}

	public void setHumidityZ(Double humidityZ) {
		this.humidityZ = humidityZ;
	}

	public void computeMASZ(double[] arrTem, double[] arrHum, double[] arrPre) {
		this.computeMAS(arrTem, arrHum, arrPre);
		this.computeZ();
	}
	
	public void computeZ() {
		if(this.maValuesNotNull() && this.sValuesNotNull() && this.scrapesNotNull()){
			this.temperatureZ = new Double(((double)this.degreesFarenheit-this.temperatureMA)/this.temperatureS);
			this.humidityZ = new Double(((double)this.humidityPct-this.humidityMA)/this.humidityS);
			this.pressureZ = new Double(((double)this.inchesOfMercury-this.pressureMA)/this.pressureS);
		}
		
	}

	public void computeMAS(double[] arrTem, double[] arrHum, double[] arrPre){
		this.temperatureMA = new Double(StatUtils.mean(arrTem));
	    this.temperatureS = new Double(new StandardDeviation().evaluate(arrTem));
	    this.humidityMA = new Double(StatUtils.mean(arrHum));
	    this.humidityS = new Double(new StandardDeviation().evaluate(arrHum));
	    this.pressureMA = new Double(StatUtils.mean(arrPre));
	    this.pressureS = new Double(new StandardDeviation().evaluate(arrPre));
	}
	
	public boolean zValuesNotNull(){
		if(this.humidityZ != null &&
				this.pressureZ != null &&
				this.temperatureZ != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean sValuesNotNull(){
		if(this.humidityS != null &&
				this.pressureS != null &&
				this.temperatureS != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean maValuesNotNull(){
		if(this.humidityMA != null &&
				this.pressureMA != null &&
				this.temperatureMA != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean scrapesNotNull(){
		if(this.degreesFarenheit != null &&
				this.inchesOfMercury != null &&
				this.humidityPct != null){
			return true;
		}else{
			return false;
		}
	}
	
	@Override
	public String toString() {
		return "WeatherSnapshot [key=" + key + ", date=" + date
				+ ", degreesFarenheit=" + degreesFarenheit
				+ ", inchesOfMercury=" + inchesOfMercury + ", humidityPct="
				+ humidityPct + ", temperatureMA=" + temperatureMA
				+ ", temperatureS=" + temperatureS + ", temperatureZ="
				+ temperatureZ + ", PressureMA=" + pressureMA + ", PressureS="
				+ pressureS + ", PressureZ=" + pressureZ + ", humidityMA="
				+ humidityMA + ", humidityS=" + humidityS + ", humidityZ="
				+ humidityZ + "]";
	}
}
