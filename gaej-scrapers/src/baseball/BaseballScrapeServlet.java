package baseball;

import static com.google.appengine.api.taskqueue.TaskOptions.Builder.withUrl;

import java.io.IOException;
import java.io.PrintWriter;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.Enumeration;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

import org.htmlparser.Node;
import org.htmlparser.Parser;
import org.htmlparser.filters.HasAttributeFilter;
import org.htmlparser.filters.OrFilter;
import org.htmlparser.util.NodeIterator;
import org.htmlparser.util.NodeList;
import org.htmlparser.util.ParserException;

import util.General;


import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.taskqueue.Queue;
import com.google.appengine.api.taskqueue.QueueFactory;
import com.google.appengine.api.taskqueue.TaskOptions.Method;

import daysummary.DaySummary;

import metabattle.PMF;
import metabattle.SportSeason;

public class BaseballScrapeServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		this.doGet(req, resp);
	}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		ArrayList<BaseballGame> games = new ArrayList<BaseballGame>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Date flatDate = null;
	    Calendar calReportDate = new GregorianCalendar(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);

		if(req.getParameterMap().containsKey("action")){
			if (req.getParameter("action").equals("adhoc")){
				calReportDate.set(
						Integer.parseInt(req.getParameter("year")), 
						Integer.parseInt(req.getParameter("month"))-1, 
						Integer.parseInt(req.getParameter("day")), 
						0, 0, 0);
			    
				flatDate = General.calendarToFlatDate(calReportDate);
			    
			    if(req.getParameterMap().containsKey("option")){
					if (req.getParameter("option").equals("crunchfromdatastoregames")){
			    
					    resp.setContentType("text/html");
						PrintWriter out = resp.getWriter();
					    out.println("Running adhoc Baseballservlet, crunch BaseballDay from Games in datastore: "+flatDate);
					    
					    // ------- get all games from day in datastore
					    Query query = pm.newQuery(BaseballGame.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("gameDate == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<BaseballGame> results = (List<BaseballGame>) query.execute(flatDate);
						    Iterator<BaseballGame> iter = results.iterator();
					        while (iter.hasNext()) {
					        	BaseballGame game = iter.next();
					        	games.add(game);
					        }
					    } finally {
					    	query.closeAll();
				        }
					}else if(req.getParameter("option").equals("preinit")){
						resp.setContentType("text/html");
						PrintWriter out = resp.getWriter();
						flatDate = General.calendarToFlatDate(calReportDate);
						SportSeason activeSportSeason = null;
						
						// returns null if none matches date
						activeSportSeason = getSportSeason(flatDate, "active");
						// only continue if date in question falls within start/end dates of currently active MLB season
					    if(activeSportSeason != null){
							BaseballDay day = new BaseballDay(); 
						    Query query = pm.newQuery("SELECT key from "+BaseballDay.class.getName());
						    query.setFilter("date == thisDate");
						    query.declareParameters("java.util.Date thisDate");
						    try {
							    List<Key> results = (List<Key>) query.execute(flatDate);
							    Iterator<Key> iter = results.iterator();
						        if(iter.hasNext()) {
						        	day.setKey(iter.next());
						        }
						    } finally {
						    	query.closeAll();
					        }
						    
						    int numGamesToday = countDaysGamesWithPreGameStatus(calReportDate);
							if(numGamesToday > 0){
								day.setSeasonId(activeSportSeason.getKey());
								day.setSeasonName(activeSportSeason.getSeasonName());
								day.setDate(flatDate);
								day.setNumGames(numGamesToday);
								Transaction tx = pm.currentTransaction();
								try{
									tx.begin();
									pm.makePersistent(day);
									tx.commit();
								}finally{
									if(tx.isActive()){
										tx.rollback();
									}
								}
								System.out.println("BaseballDay preinit complete");
								out.println("MLB Init Complete");
							}else{
								System.out.println("Zero MLB Games Scheduled for today");
								out.println("Zero MLB Games Scheduled for today");
							}
					    } // if activeSportSeason != null
					}// close preinit
					else if(req.getParameter("option").equals("rescrape")){
						System.out.println("Running MLB Rescrape");
						BaseballDay day = new BaseballDay();
						day.setDate(flatDate);
						//Transaction tx = pm.currentTransaction();
					    Query query = pm.newQuery(BaseballGame.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("gameDate == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<BaseballGame> results = (List<BaseballGame>) query.execute(flatDate);
						    for(BaseballGame g : results){
									pm.deletePersistent(g);
							}
					    } finally {
					    	query.closeAll();
				        }
					    
					    System.out.println("Rescrape: old games deleted");
					    
					    query = pm.newQuery("SELECT key FROM "+BaseballDay.class.getName());
						query.declareImports("import java.util.Date");
					    query.setFilter("date == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<Key> results = (List<Key>) query.execute(flatDate);
						    Iterator<Key> iter = results.iterator();
					        if(iter.hasNext()) {
					        	day.setKey(iter.next());
					        }
					    } finally {
					    	query.closeAll();
				        }
					    
					    if(day.getKey()==null){
					    	System.out.println("No existing BaseballDay key found for date: "+ flatDate +" running RESCRAPE - new record");
					    }else{
					    	System.out.println("MLB Rescrape: existing BaseballDay found. key set. recomputing now.");
					    }
					    
						// returns null if none matches date
					    SportSeason anySportSeason = getSportSeason(flatDate, "any");
					    
						if(anySportSeason != null){
							day.setSeasonId(anySportSeason.getKey());
							day.setSeasonName(anySportSeason.getSeasonName());
						    games = scrapeFinalGames(calReportDate);
						    
						    day.setNumGames(games.size());
						    if(day.getNumGames()>0){
							    day.sumDaysGames(games);
							    day = fetchAndComputeMAS(day);
							    if(day.sValuesNotNull()){
									day.computeZ();
								}
							    
							    pm.makePersistentAll(games);
		
								System.out.println("MLB Rescrape: saved new games");
							    
								pm.makePersistent(day);
		
								System.out.println("MLB Rescrape: completed MLB day save. complete");
						    }else{
						    	System.out.println("MLB Rescrape: zero MLB games, no action taken. complete");
						    }
						}else{
							System.out.println("MLB Rescrape: "+flatDate+" not within daterange of an MLB season");
					    }
					}
			    }//close "option"
			} //close action=adhoc
			else if(req.getParameter("action").equals("init")){
				// final init - get existing pre-init entity and update with MA&S
				PrintWriter out = resp.getWriter();
				Date finalInitDate = null;
				boolean doingAdhoc = false;
				// use current date set above - TODAY
				// if initializing before 8am use current date, otherwise use tomorrow
				if(calReportDate.get(Calendar.HOUR_OF_DAY) >= 11){
					calReportDate.add(Calendar.DATE, 1); 
				}
				if(req.getParameterMap().containsKey("option")){
					if (req.getParameter("option").equals("adhoc")){
						calReportDate.set(
								Integer.parseInt(req.getParameter("year")), 
								Integer.parseInt(req.getParameter("month"))-1, 
								Integer.parseInt(req.getParameter("day")), 
								0, 0, 0);
						doingAdhoc = true;
					}
				}
				
				finalInitDate = General.calendarToFlatDate(calReportDate);
			    
			    out.println("Running init BaseballScrapeServlet, prep for upcoming day: "+finalInitDate);
			    
			    // full init for next day
			    BaseballDay day = null;
			    Query query = pm.newQuery(BaseballDay.class);
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
				    List<BaseballDay> results = (List<BaseballDay>) query.execute(finalInitDate);
				    Iterator<BaseballDay> iter = results.iterator();
			        if(iter.hasNext()) {
			        	day = iter.next();
			        }
			    } finally {
			    	query.closeAll();
		        }
			    if(day != null){
			    	// games might have changed since pre-init, recheck. 
			    	// this check is not appropriate if doing adhoc previous day
			    	if(!doingAdhoc){
			    		day.setNumGames(countDaysGamesWithPreGameStatus(calReportDate));
			    	}
				    day = fetchAndComputeMAS(day);
					Transaction tx = pm.currentTransaction();
					try{
						tx.begin();
						pm.makePersistent(day);
						tx.commit();
					}finally{
						if(tx.isActive()){
							tx.rollback();
						}
					}
			    }else{
			    	System.out.println("No MLB Day record found for date: "+finalInitDate+". No action taken. This must mean there are no games scheduled today.");
			    }
			} //close init
		} //close action param exists
		
		// default path - close BaseballDay record
		else{
			
			// no action arg. scrape final games and finalize daySummary
			resp.setContentType("text/html");
			PrintWriter out = resp.getWriter();
			
			//do yesterday if processing between midnight and 6am
			if(calReportDate.get(Calendar.HOUR_OF_DAY) < 10){
				calReportDate.add(Calendar.DATE, -1); 
			}
			
			// CHECK FOR INPROG or PREGAME games - do not crunch day if games are still unfinished
			if(this.countDaysGamesWithInProgStatus(calReportDate)+this.countDaysGamesWithPreGameStatus(calReportDate) > 0){
				resp.sendError(HttpServletResponse.SC_EXPECTATION_FAILED, "Not all games for "+ flatDate + " are Final. Retry shortly.");
				out.println("MLB Games are still in progress or yet to begin. we don't crunch without all games final: "+flatDate);
			}else{
			    
	
				flatDate = General.calendarToFlatDate(calReportDate);
			    
			 // Baseball day should already exist from inits. load.
				BaseballDay day = null; 
			    Query query = pm.newQuery(BaseballDay.class);
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
				    List<BaseballDay> results = (List<BaseballDay>) query.execute(flatDate);
				    Iterator<BaseballDay> iter = results.iterator();
			        if(iter.hasNext()) {
			        	day = iter.next();
			        }
			    } finally {
			    	query.closeAll();
		        }
		    
			    // was BaseballDay record found?
			    if(day == null){
			    	System.out.println("No BaseballDay record found. one should exist if init ran properly this morning AND games are scheduled. date: "+flatDate);
			    }else{
					System.out.println("MLB: no pregame or inprogs left.");
					// only scrape/save games - crunch BaseballDay if ALL day's games are final. 
					
					out.println("All MLB games final: Running default flow BaseballScrapeServlet: "+flatDate);
					games = this.scrapeFinalGames(calReportDate);
					
					if(games == null){
						System.out.println("BaseballDay record found but " +
								"Games array holding today's scraped MLB games is null. scrape error perhaps.");
					}else{
						System.out.println("MLBScrape Complete. \nGames Scheduled at init:"+day.getNumGames()+
								"\nGames Scraped: "+games.size());
						
						if(games.size() != day.getNumGames()){
							day.setNumGames(games.size());
							System.out.println("Change in number of games since init. Change reflected in DaySummary and BaseballDay");
						}
						
						day.sumDaysGames(games);
						
						// S won't be present if insufficient history. 
						if(day.sValuesNotNull()){
							day.computeZ();
						}
						
						pm.makePersistentAll(games);

						Transaction tx = pm.currentTransaction();
						try{
							tx.begin();
							pm.makePersistent(day);
							tx.commit();
						}finally{
							if(tx.isActive()){
								tx.rollback();
							}
						}
						
						// if Task Queue triggered this call, send email. on success, call DaySummaryCompute
						if(req.getHeader("X-AppEngine-TaskRetryCount") != null){
							
							// check if baseball is current official season. if so, call computedaysummary
							// pull day's DaySum from datastore, check if we're official
						    DaySummary daySummary=null;
							query = pm.newQuery(DaySummary.class);
							query.declareImports("import java.util.Date");
						    query.setFilter("date == thisDate");
						    query.setRange(0, 1); //1 record only
						    query.declareParameters("Date thisDate");
						    try {
							    List<DaySummary> results = (List<DaySummary>) query.execute(day.getDate());
							    if(results != null){
							    	daySummary = results.get(0);
							    }
						    } finally {
						    	query.closeAll();
					        }
							if(daySummary.getSportKey().equals(day.getKey())){
								//handling alerts in daysummary now
								//General.sendSMSAlert("DayScale - Baseball Scrape Complete", "queueing computedaysummary");
								Queue queue = QueueFactory.getQueue("ordered-deliberate");
						        queue.add(withUrl("/cron/computedaysummary").method(Method.GET));
						        System.out.println("MLB Scrape Final OFFICIAL Complete.");
							}else{
								System.out.println("MLB Scrape Final UNOFFICIAL Complete.");
							}
						}
					} // else checking games array is null
				}// close day null check
		    }// else no inprog or pregames remaining today
		} //close if/else - does action param exist in request? else do standard day finalize
		pm.close();
	} //close doGet()
	
	private Integer countDaysGamesWithPreGameStatus(Calendar cDate) throws IOException{
		
		String dateForURL = String.valueOf(cDate.get(Calendar.YEAR)) + 
			String.format("%02d", (cDate.get(Calendar.MONTH)+1)) + 
			String.format("%02d", cDate.get(Calendar.DAY_OF_MONTH));
    
		String url = "http://scores.espn.go.com/MLB/scoreboard?date="+dateForURL;

		Parser parser = null;
		
		try {
			parser = new Parser(url);
			NodeList pregame = parser.extractAllNodesThatMatch(
					new HasAttributeFilter("class","mod-container mod-no-header-footer mod-scorebox pregame mod-scorebox-pregame"));
			
			if (pregame != null){
				return pregame.size();
			}else{
				return 0;
			}
		} catch (ParserException e) {
			throw new IOException("MLB: countDaysGamesWithPreGameStatus() ran into problems counting games. queue needs to rerun.");
		}
	}
	
	private Integer countDaysGamesWithInProgStatus(Calendar cDate) throws IOException{
		
		
		String dateForURL = String.valueOf(cDate.get(Calendar.YEAR)) + 
			String.format("%02d", (cDate.get(Calendar.MONTH)+1)) + 
			String.format("%02d", cDate.get(Calendar.DAY_OF_MONTH));
		

		String url = "http://scores.espn.go.com/MLB/scoreboard?date="+dateForURL;
		Parser parser = null;
		
		try {
			parser = new Parser(url);
			NodeList inprog = parser.extractAllNodesThatMatch(
					new HasAttributeFilter("class","mod-container mod-no-header-footer mod-scorebox in-progress mod-scorebox-in-progress"));
			
			if (inprog != null){
				return inprog.size();
			}else{
				return 0;
			}
		} catch (ParserException e) {
			throw new IOException("MLB: countDaysGamesWithInProgStatus() ran into problems counting games. queue needs to rerun.");
		}
	}
	
	private ArrayList<BaseballGame> scrapeFinalGames(Calendar cDate) throws IOException{
		System.out.println("in scrapeFinalGames function: "+cDate.toString());
		ArrayList<BaseballGame> games = new ArrayList<BaseballGame>();
		//PersistenceManager pm = PMF.get().getPersistenceManager();
		Parser parser = null;
//		Calendar cDate = new GregorianCalendar(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
//		cDate.set(
//				2011, 
//				2-1, 
//				2, 
//				0, 0, 0);
		Date flatDate = General.calendarToFlatDate(cDate);
		String dateForURL = String.valueOf(cDate.get(Calendar.YEAR)) + 
		String.format("%02d", (cDate.get(Calendar.MONTH)+1)) + 
		String.format("%02d", cDate.get(Calendar.DAY_OF_MONTH));
	

		String url = "http://scores.espn.go.com/mlb/scoreboard?date="+dateForURL;
		System.out.println("scrapeurl: "+url);
		Node gameBox;
		
	    NodeIterator iFinal = null;
		try {
			parser = new Parser(url);
			iFinal = parser.extractAllNodesThatMatch(
					new HasAttributeFilter("CLASS","mod-container mod-no-header-footer mod-scorebox final mod-scorebox-final")
			).elements();
		} catch (ParserException e) {
			e.printStackTrace();
		}
		
		try {
			while(iFinal.hasMoreNodes()){
				BaseballGame game;
				gameBox = iFinal.nextNode();
				String finalStatus = gameBox.getFirstChild().getNextSibling().getFirstChild().getFirstChild().getNextSibling().getFirstChild().toPlainTextString();
				String divHtml = gameBox.toHtml();
				String gameId = divHtml.substring(divHtml.indexOf("id=\"")+4, divHtml.indexOf("-gamebox"));
				System.out.println("this should equal 'FINAL':"+ finalStatus.substring(0,5).toUpperCase());
				// only scrape and save it status=final or final/11 etc. ignoring postponed, suspended etc
				if(finalStatus.substring(0,5).toUpperCase().equals("FINAL")){
					System.out.println("scraping game with FINAL status, id= "+gameId);
					game = scrapeBox(gameId);
					game.setGameDate(flatDate);
					games.add(game);
					System.out.println("scraped game, id= "+gameId+". new games array size= "+games.size());
				}
			} //close while iterator loop
		} catch (NumberFormatException e) {
			e.printStackTrace();
		} catch (ParserException e) {
			e.printStackTrace();
		} // try block
		return games;
	}
	
	private BaseballGame scrapeBox(String gameId) throws IOException{ 
		BaseballGame game = new BaseballGame();
		
		Parser parser = null;
		String url = "http://scores.espn.go.com/mlb/boxscore?gameId="+gameId;
		Node row = null;
	    Node nBox = null;
		try {
			parser = new Parser(url);
			NodeList modData = parser.extractAllNodesThatMatch(
					new HasAttributeFilter("CLASS","mlb-data mlb-box"));
			if(modData.size() < 4){
				System.out.println("MLB: error in BoxScrape(). modData.size()=="+modData.size()+",  < 4. queue should rerun.");
			}
			for(int box = 0; box < modData.size(); box++){
				nBox = modData.elementAt(box);
				NodeList rows = nBox.getChildren();
				
				// box 0=away bat, box 1=away pit, box 2=home bat, box 3=home pit
					for(int i=0; i<rows.size(); i++){
						row = rows.elementAt(i);
						Node val1 = row.getFirstChild();
						if(val1 != null){
							Node val2 = val1.getFirstChild();
							if(val2 != null){
								NodeList rowVals = row.getChildren();
								
									for(int j=0; j<rowVals.size(); j++){
										Node val3 = rowVals.elementAt(j);
										if(val2.toHtml().equals("Totals")){
											String meat = val3.toPlainTextString().trim();
											switch(j){
											// skip case 0, that is cell with "Totals"
											case 1:
												if(box==0){
													game.setAwayAtBats(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeAtBats(Integer.parseInt(meat));
												}else if(box==1||box==3){
													String[] pieces = meat.split("\\.");
													int outs = Integer.parseInt(pieces[0])*3;
													outs += Integer.parseInt(pieces[1]);
													if(box==1){
														game.setAwayOutsPitched(outs);
													}else{
														game.setHomeOutsPitched(outs);
													}
												}
												break;
											case 2:
												if(box==0){
													game.setAwayScore(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeScore(Integer.parseInt(meat));
												}
												break;
											case 3:
												if(box==0){
													game.setAwayHits(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeHits(Integer.parseInt(meat));
												}
												break;
											case 4:
												if(box==0){
													game.setAwayRBI(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeRBI(Integer.parseInt(meat));
												}
												break;
											case 5:
												if(box==0){
													game.setAwayBatBB(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeBatBB(Integer.parseInt(meat));
												}
												break;
											case 6:
												if(box==0){
													game.setAwayBatK(Integer.parseInt(meat));
												}else if(box==2){
													game.setHomeBatK(Integer.parseInt(meat));
												}
												break;
											case 7:
												// pitches THROWN - reversed boxes since this is from batter perspective
												if(box==0){
													game.setHomePitches(Integer.parseInt(meat));
												}else if(box==2){
													game.setAwayPitches(Integer.parseInt(meat));
												}
												break;
											case 8:
												if(box==1){
													String[] pitks = meat.split("-");
													// pitches THROWN box1=away, box3=home
													game.setAwayStrikes(Integer.parseInt(pitks[1]));
													game.setAwayPitches(Integer.parseInt(pitks[0]));
												}else if(box==3){
													String[] pitks = meat.split("-");
													
													game.setHomeStrikes(Integer.parseInt(pitks[1]));
													game.setHomePitches(Integer.parseInt(pitks[0]));
												}
												break;
											}
										}else{
											Node val4 = val3.getFirstChild().getNextSibling();
											if(val4 != null){
												NodeList batCells = val3.getChildren();
												if(i==1){
													if(box==0){
														game.setAwayTeam(val4.toHtml());
													}else if(box==1 && game.getAwayTeam()==null){
															game.setAwayTeam(val4.toHtml());
													}else if(box==2){
														game.setHomeTeam(val4.toHtml());
													}else if(box==3 && game.getHomeTeam()==null){
														game.setHomeTeam(val4.toHtml());
													}
												}
												ArrayList<String> civilized = new ArrayList<String>();
												
												for(int k=0; k<batCells.size(); k++){
													Node val5 = batCells.elementAt(k);
													String val5a = val5.toPlainTextString().trim();
													if((!val5a.equals(""))&&(!val5a.equals("<br>"))&&
															(!val5a.equals("<br />"))&&(!val5a.equals("</br>"))&&
															(!val5a.equals("<strong>"))&&(!val5a.equals("</strong>"))){
														civilized.add(val5a);
													}
												}
												if(civilized.get(0).equals("BATTING") || civilized.get(0).equals("BASERUNNING") 
														|| civilized.get(0).equals("FIELDING") || civilized.get(0).equals("PITCHING")){
													Map<String,String> keyVals = new HashMap<String,String>();
													
													// size()-1 to be sure we don't cause an error if key+vals not even. no harm. last element always = </tbody>
													for(int m=1; m<civilized.size()-1; m++){
														String key = civilized.get(m).toUpperCase();
														if(key.indexOf(":")!=-1){
															key = key.replace(":", "");
															String val = civilized.get(m+1).toUpperCase();
															val = val.replaceAll("\\(.*?\\)", "");
															val = val.replace(".", "");
															keyVals.put(key, val);
															m++;
														}
													}
													Iterator<Map.Entry<String,String>> it = keyVals.entrySet().iterator();
													
													while (it.hasNext()){
														Map.Entry<String, String> pair = (Map.Entry<String, String>)it.next();
														String[] raws = null;
														Integer finalValue = 0;
														
														//split val string on separators (either comma or semi)
														if(pair.getValue().indexOf(";") != -1){
															raws = pair.getValue().split(";");
														}else if(pair.getValue().indexOf(",") != -1){
															raws = pair.getValue().split(",");
														}else{
															// no separators, single value only
															raws = new String[1];
															raws[0] = pair.getValue();
														}
														
														for(String raw : raws){
															// special cases first. otherwise generic path
															if(pair.getKey().equals("Called strikes-Swinging strikes-Foul balls-In Play strikes".toUpperCase())){
																//matching [0-9]+ - [0-9]+ - [0-9]+ - [0-9]+
																Pattern p = Pattern.compile("\\d+\\-\\d+\\-\\d+\\-\\d+");
																Matcher m = p.matcher(raw.trim()); 
																if (m.find()) {
																	String[] indivs = m.group().split("-");
																	if(box==1){
																		game.setAwayCalledStrikes(Integer.parseInt(indivs[0])+game.getAwayCalledStrikes());
																		game.setAwaySwingingStrikes(Integer.parseInt(indivs[1])+game.getAwaySwingingStrikes());
																		game.setAwayFoulStrikes(Integer.parseInt(indivs[2])+game.getAwayFoulStrikes());
																		game.setAwayInPlayStrikes(Integer.parseInt(indivs[3])+game.getAwayInPlayStrikes());
																	}else if(box==3){
																		game.setHomeCalledStrikes(Integer.parseInt(indivs[0])+game.getHomeCalledStrikes());
																		game.setHomeSwingingStrikes(Integer.parseInt(indivs[1])+game.getHomeSwingingStrikes());
																		game.setHomeFoulStrikes(Integer.parseInt(indivs[2])+game.getHomeFoulStrikes());
																		game.setHomeInPlayStrikes(Integer.parseInt(indivs[3])+game.getHomeInPlayStrikes());
																	}
																}
															}else if(pair.getKey().equals("Ground Balls-Fly Balls".toUpperCase())){
																//matching [0-9]+ - [0-9]+
																Pattern p = Pattern.compile("\\d+\\-\\d+");
																Matcher m = p.matcher(raw.trim()); 
																if (m.find()) {
																	String[] indivs = m.group().split("-");
																	if(box==1){
																		game.setAwayGroundBalls(Integer.parseInt(indivs[0])+game.getAwayGroundBalls());
																		game.setAwayFlyBalls(Integer.parseInt(indivs[1])+game.getAwayFlyBalls());
																	}else if(box==3){
																		game.setHomeGroundBalls(Integer.parseInt(indivs[0])+game.getHomeGroundBalls());
																		game.setHomeFlyBalls(Integer.parseInt(indivs[1])+game.getHomeFlyBalls());
																	}
																}
															}else if(pair.getKey().equals("First-pitch strikes/Batters faced".toUpperCase())){
																//matching [0-9]+ / [0-9]+
																Pattern p = Pattern.compile("\\d+\\/\\d+");
																Matcher m = p.matcher(raw.trim()); 
																if (m.find()) {
																	String[] indivs = m.group().split("/");
																	if(box==1){
																		game.setAwayFirstPitchStrikes(Integer.parseInt(indivs[0])+game.getAwayFirstPitchStrikes());
																		game.setAwayBattersFaced(Integer.parseInt(indivs[1])+game.getAwayBattersFaced());
																	}else if(box==3){
																		game.setHomeFirstPitchStrikes(Integer.parseInt(indivs[0])+game.getHomeFirstPitchStrikes());
																		game.setHomeBattersFaced(Integer.parseInt(indivs[1])+game.getHomeBattersFaced());
																	}
																}
															}else{
																finalValue++;
																// looking for digits [0-9]+
																Pattern p = Pattern.compile("\\d+");
																Matcher m = p.matcher(raw.trim()); 
																while (m.find()) {
																   finalValue += Integer.parseInt(m.group())-1;
																}
															}
														}
														if(civilized.get(0).equals("BATTING")){
															if(pair.getKey().equals("2B")){
																if(box==0){
																	game.setAwayDoublesHit(finalValue);
																}else if(box==2){
																	game.setHomeDoublesHit(finalValue);
																}
															}else if(pair.getKey().equals("3B")){
																if(box==0){
																	game.setAwayTriplesHit(finalValue);
																}else if(box==2){
																	game.setHomeTriplesHit(finalValue);
																}
															}else if(pair.getKey().equals("HR")){
																if(box==0){
																	game.setAwayHomersHit(finalValue);
																}else if(box==2){
																	game.setHomeHomersHit(finalValue);
																}
															}else if(pair.getKey().equals("S")){
																if(box==0){
																	game.setAwaySacHits(finalValue);
																}else if(box==2){
																	game.setHomeSacHits(finalValue);
																}
															}else if(pair.getKey().equals("SF")){
																if(box==0){
																	game.setAwaySacFlies(finalValue);
																}else if(box==2){
																	game.setHomeSacFlies(finalValue);
																}
															}
														}else if(civilized.get(0).equals("BASERUNNING")){
															if(pair.getKey().equals("SB")){
																if(box==0){
																	game.setAwaySteals(finalValue);
																}else if(box==2){
																	game.setHomeSteals(finalValue);
																}
															}else if(pair.getKey().equals("CS")){
																if(box==0){
																	game.setAwayCaught(finalValue);
																}else if(box==2){
																	game.setHomeCaught(finalValue);
																}
															}
															
														}else if(civilized.get(0).equals("FIELDING")){
															if(pair.getKey().equals("E")){
																if(box==0){
																	game.setAwayErrors(finalValue);
																}else if(box==2){
																	game.setHomeErrors(finalValue);
																}
															}else if(pair.getKey().equals("PB")){
																if(box==0){
																	game.setAwayPassedBalls(finalValue);
																}else if(box==2){
																	game.setHomePassedBalls(finalValue);
																}
															}else if(pair.getKey().equals("DP")){
																if(box==0){
																	game.setAwayDoublePlays(finalValue);
																}else if(box==2){
																	game.setHomeDoublePlays(finalValue);
																}
															}
														}else if(civilized.get(0).equals("PITCHING")){
															if(pair.getKey().equals("IBB")){
																if(box==1){
																	game.setAwayIntentionalWalks(finalValue);
																}else if(box==3){
																	game.setHomeIntentionalWalks(finalValue);
																}
															}else if(pair.getKey().equals("WP")){
																if(box==1){
																	game.setAwayWildPitches(finalValue);
																}else if(box==3){
																	game.setHomeWildPitches(finalValue);
																}
															}else if(pair.getKey().equals("HBP")){
																if(box==1){
																	game.setAwayHitBatters(finalValue);
																}else if(box==3){
																	game.setHomeHitBatters(finalValue);
																}
															}
															
														}
													} 
												}
												
												
											}
										}
										
									}
							}
						}
						
					}
			}// close for loop boxes
		
			
		} catch (ParserException e) {
			System.out.println("ParserException caught in MLB->scrapeBox(). no biggie, but queue should rerun.");
		}
		System.out.println(game.toString());
		return game;
	}
	
	private BaseballDay fetchAndComputeMAS(BaseballDay mlbDay){
		ArrayList<Double> kpct = new ArrayList<Double>();
		ArrayList<Double> gpct = new ArrayList<Double>();
		ArrayList<Double> ops = new ArrayList<Double>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(BaseballDay.class);
		int games = 0;
		int strikes = 0;
        int pitches = 0;
        int grounders = 0;
        int flies = 0;
        int hits = 0;
        int walks = 0;
        int hitBatters = 0;
        int atBats = 0;
        int sacFlies = 0;
        int singles = 0;
        int doubles = 0;
        int triples = 0;
        int homers = 0;
        
		query.declareImports("import java.util.Date");
	    query.setFilter("date < thisDate");
	    query.setOrdering("date desc");
	    query.setRange(0, DaySummary.getMovingAverageTrailingDays());
	    query.declareParameters("Date thisDate");
	    try {
	        List<BaseballDay> results = (List<BaseballDay>) query.execute(mlbDay.getDate());
	    	// skip if # of past records aren't available
	        if(results.size()<DaySummary.getMovingAverageTrailingDays()){
	        	return mlbDay;
	        }
	        Iterator<BaseballDay> iter = results.iterator();
	        
	        int count = 0;
	        BaseballDay oldDay = null;
	        while (iter.hasNext()) {
	        	oldDay = iter.next(); 
	        	games += oldDay.getNumGames();
	        	strikes += oldDay.getStrikes();
	        	pitches += oldDay.getPitches();
	        	grounders += oldDay.getGroundBalls();
	        	flies += oldDay.getAirBalls();
	        	hits += oldDay.getHits();
	        	walks += oldDay.getWalks();
	        	hitBatters += oldDay.getHitBatters();
	        	atBats += oldDay.getAtBats();
	        	sacFlies += oldDay.getSacFlies();
	        	singles += oldDay.getSingles();
	        	doubles += oldDay.getDoubles();
	        	triples += oldDay.getTriples();
	        	homers += oldDay.getHomers();
	        	
	        	kpct.add(oldDay.getKpct());
	        	gpct.add(oldDay.getGpct());
	        	ops.add(oldDay.getOps());
	            count++;
	        } 
	    } finally {
	        query.closeAll();
	    }
	    mlbDay.setNumGamesDuringTrailingDays(games);
	    // using baseballDay to compute ten-day totals.
	    BaseballDay lastTen = new BaseballDay();
	    lastTen.setStrikes(strikes);
	    lastTen.setPitches(pitches);
	    lastTen.setGroundBalls(grounders);
	    lastTen.setAirBalls(flies);
	    lastTen.setHits(hits);
	    lastTen.setWalks(walks);
	    lastTen.setHitBatters(hitBatters);
	    lastTen.setAtBats(atBats);
	    lastTen.setSacFlies(sacFlies);
	    lastTen.setDoubles(doubles);
	    lastTen.setTriples(triples);
	    lastTen.setHomers(homers);
	    
	    mlbDay.setOpsMA(lastTen.getOps());
	    mlbDay.setKpctMA(lastTen.getKpct());
	    mlbDay.setGpctMA(lastTen.getGpct());
	    
	    double[] aKpct = new double[kpct.size()];
	    double[] aGpct = new double[gpct.size()];
	    double[] aOps = new double[ops.size()];
	    for(int i=0; i<kpct.size(); i++){
	    	aKpct[i]=kpct.get(i);
	    	aGpct[i]=gpct.get(i);
	    	aOps[i]=ops.get(i);
	    }
	    mlbDay.computeS(aKpct, aGpct, aOps);
		pm.close();
		return mlbDay;
	}
	
	private SportSeason getSportSeason(Date seasonDate, String option){
		//System.out.println("SeasonDate: "+seasonDate);
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(SportSeason.class);
		SportSeason activeSportSeason = null;
		
		// query for active MLB season entity
	    // doesn't need to be official, just active
		query.declareImports("import java.util.Date");
		query.declareParameters("Date inDate");
	    query.setFilter("sportType == \'MLB\' && dateBeg <= inDate");
		//query.setFilter("sportType == \'MLB\' && isActive == true");
	    try {
		    List<SportSeason> results = (List<SportSeason>) query.execute(seasonDate);
		    Iterator<SportSeason> iter = results.iterator();
	        while(iter.hasNext()) {
	        	SportSeason temp = iter.next();
	        	// reportDate less than or equal to endDate
	        	//System.out.println("1: "+temp.toString());
	        	if(seasonDate.compareTo(temp.getDateEnd())<=0){
	        		if((option.equals("active") && temp.getIsActive()) || option.equals("any")){
	        			activeSportSeason = temp;
	        		}
	        	}
	        }
	    } finally {
	    	query.closeAll();
        }
	    //System.out.println("getSportSeason() returns: "+activeSportSeason);
	    return activeSportSeason;
	}
}
