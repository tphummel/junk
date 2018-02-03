package weather;

import static com.google.appengine.api.taskqueue.TaskOptions.Builder.withUrl;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.GregorianCalendar;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import javax.jdo.PersistenceManager;
import javax.jdo.Query;
import javax.jdo.Transaction;
import org.htmlparser.Node;
import org.htmlparser.Parser;
import org.htmlparser.filters.HasAttributeFilter;
import org.htmlparser.util.ParserException;

import util.General;


import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.taskqueue.Queue;
import com.google.appengine.api.taskqueue.QueueFactory;
import com.google.appengine.api.taskqueue.TaskOptions.Method;

import daysummary.DaySummary;

import metabattle.PMF;

public class WeatherScrapeServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		this.doGet(req, resp);
	}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Date flatDate = null;
		PrintWriter out = null;
		WeatherSnapshot newYork = new WeatherSnapshot();
		try {
			out = resp.getWriter();
			resp.setContentType("text/html");
		} catch (IOException e1) {
			e1.printStackTrace();
		}
		
	    Calendar calReportDate = new GregorianCalendar(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		// if adhoc args are present, change report date
		// for stocks, basic data (price, range, vol, date, key needs to exist. 
		// calling adhoc computes MA, S, Z based on basic data
		if(req.getParameterMap().containsKey("action")){
			if (req.getParameter("action").equals("adhoc")){
				
				calReportDate.set(
						Integer.parseInt(req.getParameter("year")), 
						Integer.parseInt(req.getParameter("month"))-1, 
						Integer.parseInt(req.getParameter("day")), 
						0, 0, 0);

				flatDate = General.calendarToFlatDate(calReportDate);
				if(req.getParameterMap().containsKey("option")){
					if(req.getParameter("option").equals("preinit")){
						
						Query query = pm.newQuery("select key from "+WeatherSnapshot.class.getName());
						query.declareImports("import java.util.Date");
					    query.setFilter("date == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<Key> results = (List<Key>) query.execute(flatDate);
						    Iterator<Key> iter = results.iterator();
					        if(iter.hasNext()) {
					        	newYork.setKey(iter.next());
					        }
					    } finally {
					    	query.closeAll();
				        }
					    
						newYork.setDate(flatDate);
						Transaction tx = pm.currentTransaction();
						try{
							tx.begin();
							pm.makePersistent(newYork);
							tx.commit();
							System.out.println("Weather Pre-Init Success: "+flatDate);
						}finally{
							if(tx.isActive()){
								tx.rollback();
							}
						}
						
					}else if(req.getParameter("option").equals("recrunchmasz")){
						Query query = pm.newQuery(WeatherSnapshot.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("date == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<WeatherSnapshot> results = (List<WeatherSnapshot>) query.execute(flatDate);
						    Iterator<WeatherSnapshot> iter = results.iterator();
					        if(iter.hasNext()) {
					        	newYork=iter.next();
					        }
					    } finally {
					    	query.closeAll();
				        }
					    // only recompute if existing record was found.
					    if(newYork.getKey()!= null){
						    newYork = fetchAndComputeMAS(newYork);
						    newYork.computeZ();
							Transaction tx = pm.currentTransaction();
							try{
								tx.begin();
								pm.makePersistent(newYork);
								tx.commit();
								System.out.println("Weather Adhoc Recrunch MASZ Success: "+flatDate);
							}finally{
								if(tx.isActive()){
									tx.rollback();
								}
							}
					    }
					}
				}
				out.println("Finished adhoc weatherservlet: "+flatDate);
			}// close action adhoc
			else if(req.getParameter("action").equals("init")){
				
				WeatherSnapshot snap = new WeatherSnapshot();
				
				// use current date set above - TODAY
				// if initializing before 8am use current day, otherwise set to tomorrow
				if(calReportDate.get(Calendar.HOUR_OF_DAY) >= 8){
					calReportDate.add(Calendar.DATE, 1); 
				}
				
				flatDate = General.calendarToFlatDate(calReportDate);
				
				Query query = pm.newQuery("select key from "+WeatherSnapshot.class.getName());
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
			    	List<Key> results = (List<Key>) query.execute(flatDate);
				    Iterator<Key> iter = results.iterator();
			        if(iter.hasNext()) {
			        	System.out.println("key found!");
			        	snap.setKey(iter.next());
			        }
			    } finally {
			    	query.closeAll();
		        }
				
				snap.setDate(flatDate);
				snap = fetchAndComputeMAS(snap);
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					pm.makePersistent(snap);
					tx.commit();
				}finally{
					if(tx.isActive()){
						tx.rollback();
					}
				}
				out.println("Weather Init Complete: "+flatDate);
			} //close init
		} //close action parameter exists
		
		// default path - no action parameter exists
		else{
			flatDate = General.calendarToFlatDate(calReportDate);
		    
		    // WeatherSnapshot for today should already exist from init this morning. load.
		    WeatherSnapshot shot = null; 
		    Query query = pm.newQuery(WeatherSnapshot.class);
			query.declareImports("import java.util.Date");
		    query.setFilter("date == thisDate");
		    query.declareParameters("Date thisDate");
		    try {
			    List<WeatherSnapshot> results = (List<WeatherSnapshot>) query.execute(flatDate);
			    Iterator<WeatherSnapshot> iter = results.iterator();
		        if(iter.hasNext()) {
		        	shot = iter.next();
		        }
		    } finally {
		    	query.closeAll();
	        }
		    out.println("WeatherSnapshot Finalizing for: "+flatDate);
		    try {
				shot = this.scrapeFinalSnapshot(shot);
			} catch (ParserException e) {
				resp.sendError(HttpServletResponse.SC_REQUEST_TIMEOUT, "WeatherParser Exception: "+ flatDate + ". Task Queue should retry shortly.");
			}
		    if(shot != null){
		    	shot.computeZ();
		    }
		    
		    Transaction tx = pm.currentTransaction();
			try{
				tx.begin();
				pm.makePersistent(shot);
				tx.commit();
			}finally{
				if(tx.isActive()){
					tx.rollback();
				}
			}
			
			// update day summary so day view will reflect completed weather. 
			// computedaysummary default path can be run multiple times without consequence.
			Queue queue = QueueFactory.getQueue("quick-priority");
	        queue.add(withUrl("/cron/computedaysummary").method(Method.GET));
	        
	        //handling alerts in daysummary now
			//General.sendSMSAlert("DayScale", "Weather Scrape Complete");
	        
		}// close else - finalize snapshot record
		pm.close();
	}// close doGet()
	
	private WeatherSnapshot scrapeFinalSnapshot(WeatherSnapshot newYork) throws ParserException {
		String url = "http://weather.yahoo.com/united-states/new-york/new-york-2459115/";
		Parser parser = null;
		Node divTemp, divForecast;
		String strPressVal;
		
		parser = new Parser(url);
		divTemp = parser.extractAllNodesThatMatch(
				new HasAttributeFilter("ID","yw-temp")).elementAt(0);
		newYork.setDegreesFarenheit(Double.parseDouble(divTemp.getFirstChild().getText().replace("&#176;", ""))); 
		
		
		parser = new Parser(url);
		divForecast = parser.extractAllNodesThatMatch(new HasAttributeFilter("ID","yw-forecast")).elementAt(0);
		newYork.setHumid(Integer.parseInt(divForecast.getChildren().elementAt(4).getChildren().elementAt(5).getFirstChild().getText().replace(" %", ""))); 
		
		strPressVal = divForecast.getChildren().elementAt(4).getChildren().elementAt(3).getFirstChild().getText();
		strPressVal = strPressVal.substring(0,strPressVal.indexOf("i")).trim();
		
		newYork.setPress(Double.parseDouble(strPressVal));
		
		return newYork;
	}

	private WeatherSnapshot fetchAndComputeMAS(WeatherSnapshot weatherDay){
		ArrayList<Double> temp = new ArrayList<Double>();
		ArrayList<Double> humid = new ArrayList<Double>();
		ArrayList<Double> press = new ArrayList<Double>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(WeatherSnapshot.class);
		query.declareImports("import java.util.Date");
	    query.setFilter("date < thisDate");
	    query.setOrdering("date desc");
	    query.setRange(0, DaySummary.getMovingAverageTrailingDays()); //most recent X records
	    query.declareParameters("Date thisDate");
	    try {
	        List<WeatherSnapshot> results = (List<WeatherSnapshot>) query.execute(weatherDay.getDate());
	        // skip if 15 past records aren't available
	        if(results.size()<DaySummary.getMovingAverageTrailingDays()){
	        	return weatherDay;
	        }
	        Iterator<WeatherSnapshot> iter = results.iterator();
	        //System.out.println("size: "+results.size());
	        int count = 0;
	        while (iter.hasNext()) {
	        	WeatherSnapshot oldDay = iter.next();
	        	//System.out.println(iter.hasNext());
	        	temp.add(oldDay.getDegreesFarenheit());
	        	humid.add((double)oldDay.getHumid());
	        	press.add(oldDay.getPress());
	            count++;
	        } 
	    } finally {
	        query.closeAll();
	    }
	    double[] aTem = new double[temp.size()];
	    double[] aHum = new double[humid.size()];
	    double[] aPre = new double[press.size()];
	    for(int i=0; i<temp.size(); i++){
	    	aTem[i]=temp.get(i);
	    	aHum[i]=humid.get(i);
	    	aPre[i]=press.get(i);
	    }
	    weatherDay.computeMAS(aTem, aHum, aPre);
	    pm.close();
		return weatherDay;
	}
}
