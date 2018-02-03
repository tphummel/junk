package weather;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import javax.jdo.Extent;
import javax.jdo.PersistenceManager;
import javax.jdo.Query;
import javax.jdo.Transaction;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import daysummary.DaySummary;

import metabattle.PMF;


public class WeatherMaintServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;
	
	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException { this.doGet(req, resp);}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
		if(req.getParameterMap().containsKey("action")){
			if (req.getParameter("action").equals("zscores")){
				int totCount = 0;
				int chgCount = 0;
				PersistenceManager pm = PMF.get().getPersistenceManager();
				Transaction tx = pm.currentTransaction();
				Extent<WeatherSnapshot> extent = pm.getExtent(WeatherSnapshot.class, false);
			    Iterator<WeatherSnapshot> iAll = extent.iterator();
			    
			    while (iAll.hasNext()) {
			    	WeatherSnapshot weatherDay = iAll.next();
			        //if(weatherDay.getTemperatureMA() == null){
			        	ArrayList<Double> temp = new ArrayList<Double>();
			    		ArrayList<Double> humid = new ArrayList<Double>();
			    		ArrayList<Double> press = new ArrayList<Double>();
			    		Query query = pm.newQuery(WeatherSnapshot.class);
			    		query.declareImports("import java.util.Date");
			    	    query.setFilter("date < thisDate");
			    	    query.setOrdering("date desc");
			    	    query.setRange(0, DaySummary.getMovingAverageTrailingDays()); //most recent 15 records
			    	    query.declareParameters("Date thisDate");
			    	    
			    	    List<WeatherSnapshot> results = null;
			    	    Iterator<WeatherSnapshot> iTrail = null;
			    	    boolean runZScores = false;
			    	    try {
			    	        results = (List<WeatherSnapshot>) query.execute(weatherDay.getDate());
			    	        // skip if 15 past records aren't available
			    	        if(results.size()<DaySummary.getMovingAverageTrailingDays()){
			    	        	runZScores = false;
			    	        }else{
			    	        	if(weatherDay.scrapesNotNull()){
				    	        	runZScores = true;
				    	        	iTrail = results.iterator();
			    	        	}else{
			    	        		runZScores = false;
			    	        	}
			    	        }
			    	        if(runZScores){
				    	        //System.out.println("size: "+results.size());
				    	        int count = 0;
				    	        while (iTrail.hasNext()) {
				    	        	WeatherSnapshot oldDay = iTrail.next();
				    	        	//System.out.println(oldDay.toString());
				    	        	if(oldDay.scrapesNotNull()){
					    	        	temp.add(oldDay.getDegreesFarenheit());
					    	        	humid.add((double)oldDay.getHumid());
					    	        	press.add(oldDay.getPress());
					    	            count++;
				    	        	}
				    	        } 
					    	    if(count==DaySummary.getMovingAverageTrailingDays()){
						    	    double[] aTem = new double[temp.size()];
						    	    double[] aHum = new double[humid.size()];
						    	    double[] aPre = new double[press.size()];
						    	    for(int i=0; i<temp.size(); i++){
						    	    	aTem[i]=temp.get(i);
						    	    	aHum[i]=humid.get(i);
						    	    	aPre[i]=press.get(i);
						    	    }
						    	    weatherDay.computeMASZ(aTem, aHum, aPre);
						    	    try{
							        	tx.begin();
							        	pm.makePersistent(weatherDay);
							        	tx.commit();
						    	    }finally{
						    			if (tx.isActive()){
						    				tx.rollback();
						    		    }
						    		    //pm.close();
						    		}
						        	chgCount++;
					    	    }
			    	        } //runZScores = true?
			    	    } finally {
			    	        query.closeAll();
			    	    }
			        //} //tempMA = null?
			        totCount++;
			    } //extent while loop
			    extent.closeAll();
			    pm.close();
			    resp.setContentType("text/plain");
		        resp.getWriter().println("Weather Maintenance Complete: Computed Z Scores for Nulls");
		        resp.getWriter().println("Entities Checked: "+ totCount);
		        resp.getWriter().println("Entities Updated: "+ chgCount);
			}else if (req.getParameter("action").equals("setnullstodefault")){
				int totCount = 0;
				int chgCount = 0;
				PersistenceManager pm = PMF.get().getPersistenceManager();
				Transaction tx = pm.currentTransaction();
				Extent<WeatherSnapshot> extent = pm.getExtent(WeatherSnapshot.class, false);
			    Iterator<WeatherSnapshot> iAll = extent.iterator();
			    
			    while (iAll.hasNext()) {
			    	WeatherSnapshot weatherDay = iAll.next();
			        if(weatherDay.getTemperatureMA() == null){
			        	weatherDay.setHumidityMA(new Double(-99999));
			        	weatherDay.setHumidityS(new Double(-99999));
			        	weatherDay.setHumidityZ(new Double(-99999));
			        	
			        	weatherDay.setPressureMA(new Double(-99999));
			        	weatherDay.setPressureS(new Double(-99999));
			        	weatherDay.setPressureZ(new Double(-99999));
			        	
			        	weatherDay.setTemperatureMA(new Double(-99999));
			        	weatherDay.setTemperatureS(new Double(-99999));
			        	weatherDay.setTemperatureZ(new Double(-99999));
			        	
			        	try{
				        	tx.begin();
				        	pm.makePersistent(weatherDay);
				        	tx.commit();
			    	    }finally{
			    			if (tx.isActive()){
			    				tx.rollback();
			    		    }
			    		}
			    	    chgCount++;
			        }
			        totCount++;
			    }// while hasnext
			    extent.closeAll();
			    pm.close();
			    resp.setContentType("text/plain");
		        resp.getWriter().println("Weather Maintenance Complete: Set Null MA, S, Z values to -99999 and saved.");
		        resp.getWriter().println("Entities Checked: "+ totCount);
		        resp.getWriter().println("Entities Updated: "+ chgCount);
			} //if action = correctmissing
			else if (req.getParameter("action").equals("setdefaulttonull")){
				int totCount = 0;
				int chgCount = 0;
				PersistenceManager pm = PMF.get().getPersistenceManager();
				Transaction tx = pm.currentTransaction();
				Extent<WeatherSnapshot> extent = pm.getExtent(WeatherSnapshot.class, false);
			    Iterator<WeatherSnapshot> iAll = extent.iterator();
			    
			    while (iAll.hasNext()) {
			    	WeatherSnapshot weatherDay = iAll.next();
			        if(weatherDay.getTemperatureMA() == -99999){
			        	weatherDay.setHumidityMA(null);
			        	weatherDay.setHumidityS(null);
			        	weatherDay.setHumidityZ(null);
			        	
			        	weatherDay.setPressureMA(null);
			        	weatherDay.setPressureS(null);
			        	weatherDay.setPressureZ(null);
			        	
			        	weatherDay.setTemperatureMA(null);
			        	weatherDay.setTemperatureS(null);
			        	weatherDay.setTemperatureZ(null);
			        	
			        	try{
				        	tx.begin();
				        	pm.makePersistent(weatherDay);
				        	tx.commit();
			    	    }finally{
			    			if (tx.isActive()){
			    				tx.rollback();
			    		    }
			    		}
			    	    chgCount++;
			        }
			        totCount++;
			    }// while hasnext
			    extent.closeAll();
			    pm.close();
			    resp.setContentType("text/plain");
		        resp.getWriter().println("Weather Maintenance Complete: Set -99999 MA, S, Z values to null and saved.");
		        resp.getWriter().println("Entities Checked: "+ totCount);
		        resp.getWriter().println("Entities Updated: "+ chgCount);
			} //if action = correctmissing
			
		} //if key action in parameter map
	} //doGet
	
	

}
