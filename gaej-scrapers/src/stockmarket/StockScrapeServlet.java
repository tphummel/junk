package stockmarket;

import static com.google.appengine.api.taskqueue.TaskOptions.Builder.withUrl;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.UnsupportedEncodingException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.GregorianCalendar;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.TimeZone;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import javax.jdo.PersistenceManager;
import javax.jdo.Query;
import javax.jdo.Transaction;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

import org.htmlparser.Parser;
import org.htmlparser.filters.HasAttributeFilter;
import org.htmlparser.util.NodeList;
import org.htmlparser.util.ParserException;

import util.General;
import weather.WeatherSnapshot;


import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.taskqueue.Queue;
import com.google.appengine.api.taskqueue.QueueFactory;
import com.google.appengine.api.taskqueue.TaskOptions.Method;

import daysummary.DaySummary;

import metabattle.PMF;

public class StockScrapeServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		this.doGet(req, resp);
	}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		
		PersistenceManager pm = PMF.get().getPersistenceManager();
		StockPrice quote = new StockPrice();
		Date flatDate = null;
	    Calendar calReportDate = new GregorianCalendar(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
	    PrintWriter out = null;
		try {
			out = resp.getWriter();
			resp.setContentType("text/html");
		} catch (IOException e1) {
			e1.printStackTrace();
		}
		
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
						
						Query query = pm.newQuery("select key from "+StockPrice.class.getName());
						query.declareImports("import java.util.Date");
					    query.setFilter("date == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<Key> results = (List<Key>) query.execute(flatDate);
						    Iterator<Key> iter = results.iterator();
					        if(iter.hasNext()) {
					        	quote.setKey(iter.next());
					        }
					    } finally {
					    	query.closeAll();
				        }
					    if(calReportDate.get(Calendar.DAY_OF_WEEK) == 1 || calReportDate.get(Calendar.DAY_OF_WEEK) == 7 ||
								StockPrice.checkDateIsTradingHoliday(flatDate)==true){
							System.out.println("Stock Pre-Init Aborted - it is the weekend or trading holiday: "+flatDate);
						}else{
							quote.setDate(flatDate);
							quote.setName("S&P 500 Index");
							quote.setSymbol("INDEXSP:.INX");
							Transaction tx = pm.currentTransaction();
							try{
								tx.begin();
								pm.makePersistent(quote);
								tx.commit();
								System.out.println("Stock Pre-Init Success: "+flatDate);
							}finally{
								if(tx.isActive()){
									tx.rollback();
								}
							}
						}
					    
					}else if(req.getParameter("option").equals("recrunchmasz")){
						Query query = pm.newQuery(StockPrice.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("date == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<StockPrice> results = (List<StockPrice>) query.execute(flatDate);
						    Iterator<StockPrice> iter = results.iterator();
					        if(iter.hasNext()) {
					        	quote=iter.next();
					        }
					    } finally {
					    	query.closeAll();
				        }
					    // only recompute if existing record was found.
					    if(quote.getKey()!= null){
						    quote = fetchAndComputeMAS(quote);
						    quote.computeZ();
							Transaction tx = pm.currentTransaction();
							try{
								tx.begin();
								pm.makePersistent(quote);
								tx.commit();
								System.out.println("Stock Adhoc Recrunch MASZ Success: "+flatDate);
							}finally{
								if(tx.isActive()){
									tx.rollback();
								}
							}
					    }
					}
				}
				out.println("Finished adhoc stockservlet: "+flatDate);
			} //close adhoc
			else if(req.getParameter("action").equals("init")){
				
				// use current date set above
				// if initializing before 8am use current date, otherwise use tomorrow
				if(calReportDate.get(Calendar.HOUR_OF_DAY) >= 8){
					calReportDate.add(Calendar.DATE, 1); 
				}
				flatDate = General.calendarToFlatDate(calReportDate);
				StockPrice price = new StockPrice();
				if(calReportDate.get(Calendar.DAY_OF_WEEK) == 1 || calReportDate.get(Calendar.DAY_OF_WEEK) == 7 ||
						StockPrice.checkDateIsTradingHoliday(flatDate)==true){
					System.out.println("Stock Init Aborted - it is the weekend or trading holiday: "+flatDate);
				}else{
					// if record already exists. get key and replace.
					Query query = pm.newQuery("select key from "+StockPrice.class.getName());
					query.declareImports("import java.util.Date");
				    query.setFilter("date == thisDate");
				    query.declareParameters("Date thisDate");
				    try {
				    	List<Key> results = (List<Key>) query.execute(flatDate);
					    Iterator<Key> iter = results.iterator();
				        if(iter.hasNext()) {
				        	price.setKey(iter.next());
				        }
				    } finally {
				    	query.closeAll();
			        }
					
					price.setDate(flatDate);
					quote.setName("S&P 500 Index");
					quote.setSymbol("INDEXSP:.INX");
					price = fetchAndComputeMAS(price);
					Transaction tx = pm.currentTransaction();
					try{
						tx.begin();
						pm.makePersistent(price);
						tx.commit();
					}finally{
						if(tx.isActive()){
							tx.rollback();
						}
					}
					System.out.println("Stock Init Complete: "+flatDate);
				}
			} //close init
		} //close if action exists
	    
	    // default path no action parameter exists - finalize existing stockprice record
	    else{
		flatDate = General.calendarToFlatDate(calReportDate);
	    	if(calReportDate.get(Calendar.DAY_OF_WEEK) == 1 || calReportDate.get(Calendar.DAY_OF_WEEK) == 7 ||
					StockPrice.checkDateIsTradingHoliday(flatDate)==true){
				// weekend do nothing
				out.println("Stock Finalize Aborted - it is the weekend or trading holiday: "+flatDate);
			}else{
		    	
				    
			    // StockPrice for today should already exist from init this morning. load. (if market is open)
			    StockPrice price = null; 
			    Query query = pm.newQuery(StockPrice.class);
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
				    List<StockPrice> results = (List<StockPrice>) query.execute(flatDate);
				    Iterator<StockPrice> iter = results.iterator();
			        if(iter.hasNext()) {
			        	price = iter.next();
			        }
			    } finally {
			    	query.closeAll();
		        }
			    if(price != null){
				    out.println("StockPrice Finalizing for: "+flatDate);
					
				    try {
						price = this.scrapeFinalData(price);
					} catch (ParserException e) {
						resp.sendError(HttpServletResponse.SC_REQUEST_TIMEOUT, "StockParser Exception: "+ flatDate + ". Task Queue should retry shortly.");
					}
					if(price.getPriceMA() != null){
						price.computeZ();
					}
					
					Transaction tx = pm.currentTransaction();
					try{
						tx.begin();
						pm.makePersistent(price);
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
			        
					//General.sendSMSAlert("DayScale", "Stock Scrape Complete");
			      //handling alerts in daysummary now
					
					
			    }else{
			    	System.out.println("Stock Finalize Aborted - no record from init, markets must be closed: "+flatDate);
			    }
			}// close day of week check
	    } // close default path "else"
		pm.close();
	} // close doGet()
	
	private StockPrice scrapeFinalData(StockPrice quote) throws ParserException {
		String url = "http://www.google.com/finance?q=INDEXSP:.INX";
		Parser parser = null;
		String strRange = "";
		NodeList list;

		parser = new Parser(url);
		quote.setPrice(
				Double.parseDouble(
						parser.extractAllNodesThatMatch(
								new HasAttributeFilter("ID","ref_626307_l")).elementAt(0).getFirstChild().getText().replace(",", "")));
		
		parser = new Parser(url);
		quote.setDollarChange(
				Double.parseDouble(
						parser.extractAllNodesThatMatch(
								new HasAttributeFilter("ID","ref_626307_c")).elementAt(0).getFirstChild().getText().replace(",", "")));
		
		parser = new Parser(url);
		quote.setPercentChange(
				Double.parseDouble(
						parser.extractAllNodesThatMatch(
								new HasAttributeFilter("ID","ref_626307_cp")).elementAt(0).getFirstChild().getText().replace(",", "").replace("(","").replace(")","").replace("%","")));
		parser = new Parser(url);
		list = parser.extractAllNodesThatMatch(
				new HasAttributeFilter("CLASS","goog-inline-block val"));
		
		strRange = list.elementAt(0).getFirstChild().getText().replace(",", "");
		
		try{
			quote.setDayLow(Double.parseDouble(strRange.substring(0, strRange.lastIndexOf("-")).trim()));
			quote.setDayHigh(Double.parseDouble(strRange.substring(strRange.lastIndexOf("-")).replace("-","").trim()));
			quote.setRange(quote.getDayHigh()-quote.getDayLow());
		}catch(NumberFormatException e){
			e.printStackTrace();
			General.sendSMSAlert("Stock Error", "problem parsing stock data. looks like google fucked up");
			quote.setDayLow(0.0);
			quote.setDayHigh(0.0);
			quote.setRange(0.0);
		}
		
		// process volume to integer in millions
		String strVolume = list.elementAt(3).getFirstChild().getText();
		int volInMils = 0;
		if(strVolume.endsWith("B")){
			//strVolumestrVolume.substring(0, strVolume.indexOf("B"));
			strVolume = strVolume.replace("B", "");
			try{
				volInMils = (int)(Double.parseDouble(strVolume)*1000);
			}catch(NumberFormatException e){
		        e.printStackTrace();
			}
		}
		quote.setVolumeInMillions(volInMils);
		
		return quote;
	}

	private StockPrice fetchAndComputeMAS(StockPrice stock){
		ArrayList<Double> prices = new ArrayList<Double>();
		ArrayList<Double> volumes = new ArrayList<Double>();
		ArrayList<Double> ranges = new ArrayList<Double>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(StockPrice.class);
		query.declareImports("import java.util.Date");
	    query.setFilter("date < thisDate");
	    query.setOrdering("date desc");
	    query.setRange(0, DaySummary.getMovingAverageTrailingDays()); //most recent 15 records
	    query.declareParameters("Date thisDate");
	    try {
	        List<StockPrice> results = (List<StockPrice>) query.execute(stock.getDate());
	        // skip if 15 past records aren't available
	        if(results.size()<DaySummary.getMovingAverageTrailingDays()){
	        	return stock;
	        }
	        Iterator<StockPrice> iter = results.iterator();
	        int count = 0;
	        while (iter.hasNext()) {
	        	StockPrice oldStock = iter.next(); 
	        	prices.add(oldStock.getPrice());
	        	volumes.add((double)oldStock.getVolumeInMillions());
	        	ranges.add(oldStock.getRange());
	            count++;
	        } 
	    } finally {
	        query.closeAll();
	    }
	    double[] aTot = new double[prices.size()];
	    double[] aWin = new double[volumes.size()];
	    double[] aHom = new double[ranges.size()];
	    for(int i=0; i<prices.size(); i++){
	    	aTot[i]=prices.get(i);
	    	aWin[i]=volumes.get(i);
	    	aHom[i]=ranges.get(i);
	    }
	    stock.computeMAS(aTot, aWin, aHom);
	    pm.close();
		return stock;
	}
			
		
}
