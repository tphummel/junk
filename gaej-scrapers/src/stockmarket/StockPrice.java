package stockmarket;

import javax.jdo.annotations.IdGeneratorStrategy;
import javax.jdo.annotations.PersistenceCapable;
import javax.jdo.annotations.Persistent;
import javax.jdo.annotations.PrimaryKey;
import org.apache.commons.math.stat.StatUtils;
import org.apache.commons.math.stat.descriptive.moment.StandardDeviation;

import util.General;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import com.google.appengine.api.datastore.Key;

@PersistenceCapable
public class StockPrice {
	@PrimaryKey
	@Persistent(valueStrategy = IdGeneratorStrategy.IDENTITY)
	private Key key;
	@Persistent
	private String symbol;
	@Persistent
	private String name;
	@Persistent
	private Date date;
	@Persistent
	private Double price = null;
	@Persistent
	private Double priceMA = null;
	@Persistent
	private Double priceS = null;
	@Persistent
	private Double priceZ = null;
	@Persistent
	private Double dollarChange = null;
	@Persistent
	private Double percentChange = null;
	@Persistent
	private Integer volumeInMillions = null;
	@Persistent
	private Double volumeMA = null;
	@Persistent
	private Double volumeS = null;
	@Persistent
	private Double volumeZ = null;
	@Persistent
	private Double dayHigh = null;
	@Persistent
	private Double dayLow = null;
	@Persistent
	private Double range = null;
	@Persistent
	private Double rangeMA = null;
	@Persistent
	private Double rangeS = null;
	@Persistent
	private Double rangeZ = null;
	
	public StockPrice() {
		super();
		this.date = new Date();
	}
	public Key getKey() {
		return key;
	}
	public void setKey(Key key) {
		this.key = key;
	}
	public String getSymbol() {
		return symbol;
	}
	public void setSymbol(String symbol) {
		this.symbol = symbol;
	}
	public String getName() {
		return name;
	}
	public void setName(String name) {
		this.name = name;
	}
	public Date getDate() {
		return date;
	}
	public void setDate(Date date) {
		this.date = date;
	}
	
	public Double getPrice() {
		return price;
	}
	public void setPrice(Double price) {
		this.price = price;
	}
	public Double getDollarChange() {
		return dollarChange;
	}
	public void setDollarChange(Double dollarChange) {
		this.dollarChange = dollarChange;
	}
	public Double getPercentChange() {
		return percentChange;
	}
	public void setPercentChange(Double percentChange) {
		this.percentChange = percentChange;
	}
	public Integer getVolumeInMillions() {
		return volumeInMillions;
	}
	public void setVolumeInMillions(Integer volumeInMillions) {
		this.volumeInMillions = volumeInMillions;
	}
	public Double getDayHigh() {
		return dayHigh;
	}
	public void setDayHigh(Double dayHigh) {
		this.dayHigh = dayHigh;
	}
	public Double getDayLow() {
		return dayLow;
	}
	public void setDayLow(Double dayLow) {
		this.dayLow = dayLow;
	}
	public Double getRange() {
		return range;
	}
	public void setRange(Double range) {
		this.range = range;
	}
	public Double getPriceMA() {
		return priceMA;
	}
	public void setPriceMA(Double priceMA) {
		this.priceMA = priceMA;
	}
	public Double getPriceS() {
		return priceS;
	}
	public void setPriceS(Double priceS) {
		this.priceS = priceS;
	}
	public Double getPriceZ() {
		return priceZ;
	}
	public void setPriceZ(Double priceZ) {
		this.priceZ = priceZ;
	}
	public Double getVolumeMA() {
		return volumeMA;
	}
	public void setVolumeMA(Double volumeMA) {
		this.volumeMA = volumeMA;
	}
	public Double getVolumeS() {
		return volumeS;
	}
	public void setVolumeS(Double volumeS) {
		this.volumeS = volumeS;
	}
	public Double getVolumeZ() {
		return volumeZ;
	}
	public void setVolumeZ(Double volumeZ) {
		this.volumeZ = volumeZ;
	}
	public Double getRangeMA() {
		return rangeMA;
	}
	public void setRangeMA(Double rangeMA) {
		this.rangeMA = rangeMA;
	}
	public Double getRangeS() {
		return rangeS;
	}
	public void setRangeS(Double rangeS) {
		this.rangeS = rangeS;
	}
	public Double getRangeZ() {
		return rangeZ;
	}
	public void setRangeZ(Double rangeZ) {
		this.rangeZ = rangeZ;
	}
	@Override
	public String toString() {
		return "StockPrice [key=" + key + ", symbol=" + symbol + ", name="
				+ name + ", date=" + date + ", price=" + price + ", priceMA="
				+ priceMA + ", priceS=" + priceS + ", priceZ=" + priceZ
				+ ", dollarChange=" + dollarChange + ", percentChange="
				+ percentChange + ", volumeInMillions=" + volumeInMillions
				+ ", volumeMA=" + volumeMA + ", volumeS=" + volumeS
				+ ", volumeZ=" + volumeZ + ", dayHigh=" + dayHigh + ", dayLow="
				+ dayLow + ", range=" + range + ", rangeMA=" + rangeMA
				+ ", rangeS=" + rangeS + ", rangeZ=" + rangeZ + "]";
	}
	/*public void computeZScores(double[] arrPri, double[] arrVol, double[] arrRan) {
		this.computeMAS(arrPri, arrVol, arrRan);
		this.computeZ();
		
	}*/
	
	public void computeMAS(double[] arrPri, double[] arrVol, double[] arrRan){
		this.priceMA = new Double(StatUtils.mean(arrPri));
	    this.priceS = new Double(new StandardDeviation().evaluate(arrPri));
	    this.volumeMA = new Double(StatUtils.mean(arrVol));
	    this.volumeS = new Double(new StandardDeviation().evaluate(arrVol));
	    this.rangeMA = new Double(StatUtils.mean(arrRan));
	    this.rangeS = new Double(new StandardDeviation().evaluate(arrRan));
	}
	
	public void computeZ(){
		if(this.maValuesNotNull() && this.sValuesNotNull() && this.scrapesNotNull()){
		this.priceZ = new Double(((double)this.price-this.priceMA)/this.priceS);

		this.volumeZ = new Double(((double)this.volumeInMillions-this.volumeMA)/this.volumeS);
		
		this.rangeZ = new Double(((double)this.range-this.rangeMA)/this.rangeS);
		}
	}
	
	public boolean zValuesNotNull(){
		if(this.priceZ != null &&
				this.volumeZ != null &&
				this.rangeZ != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean sValuesNotNull(){
		if(this.priceS != null &&
				this.volumeS != null &&
				this.rangeS != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean maValuesNotNull(){
		if(this.priceMA != null &&
				this.volumeMA != null &&
				this.rangeMA != null){
			return true;
		}else{ 
			return false;
		}
	}
	
	public boolean scrapesNotNull(){
		if(this.price != null &&
				this.volumeInMillions != null &&
				this.range != null){
			return true;
		}else{
			return false;
		}
	}
	
	public static Boolean checkDateIsTradingHoliday(Date dayInQuestion){
		Boolean isHoliday = false;
		ArrayList<Date> holidays = new ArrayList<Date>();
		// subtract 1 from all MONTHS
		Calendar martinLutherKingJrDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		martinLutherKingJrDay.set(2011, 0, 17, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(martinLutherKingJrDay));
		
		Calendar presidentsDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		presidentsDay.set(2011, 1, 21, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(presidentsDay));
		
		Calendar goodFriday = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		goodFriday.set(2011, 3, 22, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(goodFriday));
		
		Calendar memorialDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		memorialDay.set(2011, 4, 30, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(memorialDay));
		
		Calendar independenceDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		independenceDay.set(2011, 6, 4, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(independenceDay));
		
		Calendar laborDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		laborDay.set(2011, 8, 5, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(laborDay));
		
		Calendar thanksgivingDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		thanksgivingDay.set(2011, 10, 24, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(thanksgivingDay));
		
		Calendar christmasDay = Calendar.getInstance(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		christmasDay.set(2011, 11, 26, 0, 0, 0);
		holidays.add(General.calendarToFlatDate(christmasDay));
		
		// i think this is the best way:
		// "The result is true if and only if the argument is not null and is a Calendar object that represents the same calendar as this object"
		
		if(holidays.contains(dayInQuestion)){
			isHoliday = true;
		}
		
		return isHoliday;
	}
	
	
	
}
