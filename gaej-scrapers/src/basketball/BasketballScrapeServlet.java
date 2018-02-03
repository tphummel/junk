package basketball;

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

/**
 * @author Tom
 * doGet() has two major flow paths. 
 * 1. action param exists and = "adhoc" - compute BasketballDay based on BasketballGame recs already in datastore for date supplied
 * 2. default path - for current date, attempt to scrape results. if all games are final save games and crunch BasketballDay
 */

public class BasketballScrapeServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		this.doGet(req, resp);
	}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		ArrayList<BasketballGame> games = new ArrayList<BasketballGame>();
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
					    out.println("Running adhoc basketballservlet, crunch BasketballDay from Games in datastore: "+flatDate);
					    
					    // ------- get all games from day in datastore
					    Query query = pm.newQuery(BasketballGame.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("gameDate == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<BasketballGame> results = (List<BasketballGame>) query.execute(flatDate);
						    Iterator<BasketballGame> iter = results.iterator();
					        while (iter.hasNext()) {
					        	BasketballGame game = iter.next();
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
						activeSportSeason = getSportSeason(flatDate, "active");
						// only continue if date in question falls within start/end dates of currently active NBA season
					    if(activeSportSeason != null){
							BasketballDay day = new BasketballDay(); 
						    Query query = pm.newQuery("SELECT key from "+BasketballDay.class.getName());
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
								day.setDate(flatDate);
								day.setNumGames(numGamesToday);
								// don't compute MAS for pre-init
								//hoopsDay = fetchAndComputeMAS(hoopsDay);
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
								System.out.println("BasketballDay preinit complete");
								out.println("Init Complete");
							}else{
								System.out.println("Zero Games Scheduled for today");
								out.println("Zero Games Scheduled for today");
							}
					    } // if activeSportSeason != null
					}// close preinit
					else if(req.getParameter("option").equals("rescrape")){
						System.out.println("Running Rescrape");
						BasketballDay day = new BasketballDay();
						day.setDate(flatDate);
						//Transaction tx = pm.currentTransaction();
					    Query query = pm.newQuery(BasketballGame.class);
						query.declareImports("import java.util.Date");
					    query.setFilter("gameDate == thisDate");
					    query.declareParameters("Date thisDate");
					    try {
						    List<BasketballGame> results = (List<BasketballGame>) query.execute(flatDate);
						    for(BasketballGame g : results){
									pm.deletePersistent(g);
							}
					    } finally {
					    	query.closeAll();
				        }
					    
					    System.out.println("Rescrape: old games deleted");
					    
					    query = pm.newQuery("SELECT key FROM "+BasketballDay.class.getName());
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
					    	System.out.println("No existing BasketballDay key found for date: "+ flatDate +" running RESCRAPE - new record");
					    }else{
					    	System.out.println("Rescrape: existing BasketballDay found. key set. recomputing now.");
					    }
					    
					    SportSeason anySportSeason = getSportSeason(flatDate, "any");
						if(anySportSeason != null){
							day.setSeasonId(anySportSeason.getKey());
						    games = scrapeFinalGames(calReportDate);
						    day.setNumGames(games.size());
						    if(day.getNumGames()>0){
							    day.sumDaysGames(games);
							    day = fetchAndComputeMAS(day);
							    if(day.sValuesNotNull()){
									day.computeZ();
								}
							    
							    pm.makePersistentAll(games);
		
								System.out.println("Rescrape: saved new games");
							    
								pm.makePersistent(day);
		
								System.out.println("Rescrape: completed hoopsday save. complete");
						    }else{
						    	System.out.println("Rescrape: zero games, no action taken. complete");
						    }
						}else{
							System.out.println("NBA Rescrape: "+flatDate+" not within daterange of an NBA season");
						}
					}
			    }//close "option"
			} //close action=adhoc
			else if(req.getParameter("action").equals("init")){
				// final init - get existing pre-init entity and update with MA&S
				PrintWriter out = resp.getWriter();
				Date finalInitDate = null;
				// use current date set above - TODAY
				// if initializing before 8am use current date, otherwise use tomorrow
				if(calReportDate.get(Calendar.HOUR_OF_DAY) >= 11){
					calReportDate.add(Calendar.DATE, 1); 
				}
				
				finalInitDate = General.calendarToFlatDate(calReportDate);
			    
			    out.println("Running init BasketballScrapeServlet, prep for upcoming day: "+finalInitDate);
			    
			    // full init for next day
			    BasketballDay day = new BasketballDay(); 
			    Query query = pm.newQuery("SELECT key FROM "+BasketballDay.class.getName());
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
				    List<Key> results = (List<Key>) query.execute(finalInitDate);
				    Iterator<Key> iter = results.iterator();
			        if(iter.hasNext()) {
			        	day.setKey(iter.next());
			        }
			    } finally {
			    	query.closeAll();
		        }
			    if(day.getKey() != null){
			    	day.setDate(finalInitDate);
			    	day.setNumGames(countDaysGamesWithPreGameStatus(calReportDate));
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
			    	System.out.println("No key found for date: "+finalInitDate+". No action taken. This must mean there are no games scheduled today.");
			    }
			} //close init
		} //close action param exists
		
		// default path - close BasketballDay record
		else{
			
			// no action arg. scrape final games and finalize daySummary
			resp.setContentType("text/html");
			PrintWriter out = resp.getWriter();
			
			// CHECK FOR INPROG or PREGAME games - do not crunch day if games are still unfinished
			if(this.countDaysGamesWithInProgStatus(calReportDate)+this.countDaysGamesWithPreGameStatus(calReportDate) > 0){
				resp.sendError(HttpServletResponse.SC_EXPECTATION_FAILED, "Not all games for "+ flatDate + " are Final. Retry shortly.");
				out.println("Games are still in progress or yet to begin. we don't crunch without all games final: "+flatDate);
			}else{
			    //do yesterday if processing between midnight and 6am
				if(calReportDate.get(Calendar.HOUR_OF_DAY) < 6){
					calReportDate.add(Calendar.DATE, -1); 
				}
	
				flatDate = General.calendarToFlatDate(calReportDate);
			    
			 // Basketball day should already exist from init this morning. load.
				BasketballDay day = null; 
			    Query query = pm.newQuery(BasketballDay.class);
				query.declareImports("import java.util.Date");
			    query.setFilter("date == thisDate");
			    query.declareParameters("Date thisDate");
			    try {
				    List<BasketballDay> results = (List<BasketballDay>) query.execute(flatDate);
				    Iterator<BasketballDay> iter = results.iterator();
			        if(iter.hasNext()) {
			        	day = iter.next();
			        }
			    } finally {
			    	query.closeAll();
		        }
		    
			    // was BasketballDay record found?
			    if(day == null){
			    	System.out.println("No BasketballDay record found. one should exist if init ran properly this morning AND games are scheduled. date: "+flatDate);
			    }else{
					System.out.println("no pregame or inprogs left.");
					// only scrape/save games - crunch BasketballDay if ALL day's games are final. 
					
					out.println("All games final: Running default flow BasketballScrapeServlet: "+flatDate);
					games = this.scrapeFinalGames(calReportDate);
					
					if(games == null){
						System.out.println("BasketballDay record found but " +
								"Games array holding today's scraped NBA games is null. scrape error perhaps.");
					}else{
						System.out.println("HoopScrape Complete. \nGames Scheduled at init:"+day.getNumGames()+
								"\nGames Scraped: "+games.size());
						
						if(games.size() != day.getNumGames()){
							day.setNumGames(games.size());
							System.out.println("Change in number of games since init. Change reflected in DaySummary and BasketballDay");
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
							//handling alerts in daysummary now
							//General.sendSMSAlert("DayScale - Basketball Scrape Complete", "queueing computedaysummary");
							
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
								Queue queue = QueueFactory.getQueue("ordered-deliberate");
						        queue.add(withUrl("/cron/computedaysummary").method(Method.GET));
						        System.out.println("HoopScrape OFFICIAL Final Complete.");
							}else{
								System.out.println("HoopScrape UNOFFICIAL Final Complete.");
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
    
		String url = "http://scores.espn.go.com/nba/scoreboard?date="+dateForURL;

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
			throw new IOException("countDaysGamesWithPreGameStatus() ran into problems counting games. queue needs to rerun.");
		}
	}
	
	private Integer countDaysGamesWithInProgStatus(Calendar cDate) throws IOException{
		
		
		String dateForURL = String.valueOf(cDate.get(Calendar.YEAR)) + 
			String.format("%02d", (cDate.get(Calendar.MONTH)+1)) + 
			String.format("%02d", cDate.get(Calendar.DAY_OF_MONTH));
		

		String url = "http://scores.espn.go.com/nba/scoreboard?date="+dateForURL;
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
			throw new IOException("countDaysGamesWithInProgStatus() ran into problems counting games. queue needs to rerun.");
		}
	}
	
	
	
	private ArrayList<BasketballGame> scrapeFinalGames(Calendar cDate){
		ArrayList<BasketballGame> games = new ArrayList<BasketballGame>();
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
	

		String url = "http://scores.espn.go.com/nba/scoreboard?date="+dateForURL;
		Node gameBox, modContent, gameHeader, headlineDiv, gameHeaderTable, awaytr, hometr, awayTmNmTd, homeTmNmTd;
		
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
				BasketballGame game = null;
				gameBox = iFinal.nextNode();
				String divHtml = gameBox.toHtml();
				String gameId = divHtml.substring(divHtml.indexOf("id=\"")+4, divHtml.indexOf("-gamebox"));
				
				game = scrapeBox(gameId);
				if(game!=null){
					modContent = gameBox.getChildren().elementAt(1);
					gameHeader = modContent.getFirstChild();
					headlineDiv = gameHeader.getNextSibling().getNextSibling();
					gameHeaderTable = gameHeader.getFirstChild();
					
					awaytr = gameHeaderTable.getFirstChild().getNextSibling();
					hometr = awaytr.getNextSibling().getNextSibling(); //skip 1, between is records
					
					awayTmNmTd = awaytr.getFirstChild();
					Node awayTmNode = awayTmNmTd.getFirstChild().getFirstChild();
					if(awayTmNode.getFirstChild() != null){
						game.setAwayTeam(awayTmNode.getFirstChild().getText());
					}else{
						// All-Star Game clause - handles case when team name isn't in an <a> tag
						game.setAwayTeam(awayTmNode.getText());
					}
					System.out.println(game.getAwayTeam());
	
					homeTmNmTd = hometr.getFirstChild();
					Node homeTmNode = homeTmNmTd.getFirstChild().getFirstChild();
					if(homeTmNode.getFirstChild() != null){
						game.setHomeTeam(homeTmNode.getFirstChild().getText());
					}else{
						// All-Star Game clause - handles case when team name isn't in an <a> tag
						game.setHomeTeam(homeTmNode.getText());
					}
	
					// just replay links or null if no headline - headline is sometimes missing if game has concluded recently. ignore, not biggy.
					if(headlineDiv.getFirstChild().getFirstChild() != null){
						if(!headlineDiv.getFirstChild().getFirstChild().getText().equals("Watch&nbsp;Replay&nbsp;")){
							game.setHeadline(headlineDiv.getFirstChild().getFirstChild().getText());
						}
					}
					game.setGameDate(flatDate);
					
					games.add(game);
				}// if game != null
			} //close while iterator loop
		} catch (NumberFormatException e) {
			e.printStackTrace();
		} catch (ParserException e) {
			e.printStackTrace();
		} // try block
		return games;
	}
	
	private BasketballGame scrapeBox(String gameId){ 
		BasketballGame game = new BasketballGame();
		
		Parser parser = null;
		String url = "http://scores.espn.go.com/nba/boxscore?gameId="+gameId;
		System.out.println("scrapeBox: "+url);
		Node row, cell, meat;
		
	    NodeIterator iFinal = null, iCells = null;
		try {
			parser = new Parser(url);
			NodeList modData = parser.extractAllNodesThatMatch(
					new HasAttributeFilter("CLASS","mod-data"));
			if(modData == null){
				return null;
			}else if(modData.size() == 0){
				return null;
			}
			
			iFinal = modData.elements().nextNode().getChildren().elements();
		} catch (ParserException e) {
			e.printStackTrace();
		}
		
		try {
			
			int j=1;//counts cells 1-12 for road, 13-24 for home
			while(iFinal.hasMoreNodes()){
				row = iFinal.nextNode();
				if(row != null){
					cell = row.getFirstChild();
					if(cell != null){
						cell = cell.getFirstChild();
						if(cell != null){
							if(cell.getText().equals("TOTALS")){
								row = row.getNextSibling().getNextSibling().getNextSibling().getNextSibling();
								if(row != null){
									iCells = row.getChildren().elements();
									
									while(iCells.hasMoreNodes()){
										cell = iCells.nextNode();
										if(cell != null){
											cell = cell.getFirstChild();
											if(cell != null){
												meat = cell.getNextSibling();
												if(meat != null){
													String val = meat.getText();
													//System.out.println(j+": "+val);
													//handle hypenated values
													if(j==1 || j==2 || j==3|| j==13 || j==14|| j==15){
														int made;
														int att;
														try{
															made = Integer.parseInt(val.substring(0, val.indexOf("-")));
														}catch(NumberFormatException e){
															made = -1;
														}
														try{
															att = Integer.parseInt(val.substring(val.indexOf("-")+1));
														}catch(NumberFormatException e){
															att = -1;
														}
														switch(j){
														case 1:
															game.setAwayFGA(att);
															game.setAwayFGM(made);
															break;
														case 2:
															game.setAwayTPA(att);
															game.setAwayTPM(made);
															break;
														case 3:
															game.setAwayFTA(att);
															game.setAwayFTM(made);
															break;
														case 13:
															game.setHomeFGA(att);
															game.setHomeFGM(made);
															break;
														case 14:
															game.setHomeTPA(att);
															game.setHomeTPM(made);
															break;
														case 15:
															game.setHomeFTA(att);
															game.setHomeFTM(made);
															break;
														}
													}else{
														// handle non-hyphenated values
														int stat;
														try{
															stat = Integer.parseInt(val);
														}catch(NumberFormatException e){
															stat = -1;
														}
														switch(j){
														case 4:
															game.setAwayOreb(stat);
															break;
														case 5:
															game.setAwayDreb(stat);
															break;
														case 6:
															// total reb, not collecting
															break;
														case 7:
															game.setAwayAst(stat);
															break;
														case 8:
															game.setAwayStl(stat);
															break;
														case 9:
															game.setAwayBlk(stat);
															break;
														case 10:
															game.setAwayTO(stat);
															break;
														case 11:
															game.setAwayPF(stat);
															break;
														case 12:
															game.setAwayScore(stat);
															break;
															
														case 16:
															game.setHomeOreb(stat);
															break;
														case 17:
															game.setHomeDreb(stat);
															break;
														case 18:
															// total reb, not collecting
															break;
														case 19:
															game.setHomeAst(stat);
															break;
														case 20:
															game.setHomeStl(stat);
															break;
														case 21:
															game.setHomeBlk(stat);
															break;
														case 22:
															game.setHomeTO(stat);
															break;
														case 23:
															game.setHomePF(stat);
															break;
														case 24:
															game.setHomeScore(stat);
															break;
														}
													}
													j++;
												}
											}
										}
										
									}
								}
							}
							
						}
					}
				}
			} //close while iterator loop - data rows of box
		} catch (NumberFormatException e) {
			e.printStackTrace();
		} catch (ParserException e) {
			e.printStackTrace();
		} // try block
		return game;
	}
	
	private BasketballDay fetchAndComputeMAS(BasketballDay hoopsDay){
		ArrayList<Double> ppg = new ArrayList<Double>();
		ArrayList<Double> ft = new ArrayList<Double>();
		ArrayList<Double> oreb = new ArrayList<Double>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(BasketballDay.class);
		int gms = 0;
        int pts = 0;
        int fta = 0;
        int ftm = 0;
        int orb = 0;
        int trb = 0;
		query.declareImports("import java.util.Date");
	    query.setFilter("date < thisDate");
	    query.setOrdering("date desc");
	    query.setRange(0, DaySummary.getMovingAverageTrailingDays());
	    query.declareParameters("Date thisDate");
	    try {
	        List<BasketballDay> results = (List<BasketballDay>) query.execute(hoopsDay.getDate());
	    	// skip if # of past records aren't available
	        if(results.size()<DaySummary.getMovingAverageTrailingDays()){
	        	return hoopsDay;
	        }
	        Iterator<BasketballDay> iter = results.iterator();
	        
	        int count = 0;
	        
	        while (iter.hasNext()) {
	        	BasketballDay oldDay = iter.next(); 
	        	gms += oldDay.getNumGames();
	        	pts += oldDay.getTotalPoints();
	        	fta += oldDay.getCombFta();
	        	ftm += oldDay.getCombFtm();
	        	orb += oldDay.getCombOrebs();
	        	trb += oldDay.getCombTrebs();
	        	ppg.add((double)oldDay.getTotalPoints()/oldDay.getNumGames());
	        	ft.add((double)oldDay.getCombFtm()/oldDay.getCombFta());
	        	oreb.add((double)oldDay.getCombOrebs()/oldDay.getCombTrebs());
	            count++;
	        } 
	    } finally {
	        query.closeAll();
	    }
	    hoopsDay.setOrebPctMA((double)orb/trb);
	    hoopsDay.setFtPctMA((double)ftm/fta);
	    hoopsDay.setPpgMA((double)pts/gms);
	    
	    double[] aPpg = new double[ppg.size()];
	    double[] aFta = new double[ft.size()];
	    double[] aOreb = new double[oreb.size()];
	    for(int i=0; i<ppg.size(); i++){
	    	aPpg[i]=ppg.get(i);
	    	aFta[i]=ft.get(i);
	    	aOreb[i]=oreb.get(i);
	    }
	    hoopsDay.computeS(aPpg, aFta, aOreb);
		pm.close();
		return hoopsDay;
	}
	
	private ArrayList<BasketballGame> oldScrapeFinalGames(Date flatDate){
		ArrayList<BasketballGame> games = new ArrayList<BasketballGame>();
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Parser parser = null;
		String url = "http://scores.espn.go.com/nba/scoreboard";
		Node gameBox, modContent, gameHeader, headlineDiv, gameHeaderTable, awaytr, hometr, awayTmNmTd, awayTmScrTd, homeTmNmTd, homeTmScrTd;
		
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
				//System.out.println("has more nodes loop");
				BasketballGame game = new BasketballGame();
				gameBox = iFinal.nextNode();
				modContent = gameBox.getChildren().elementAt(1);
				gameHeader = modContent.getFirstChild();
				headlineDiv = gameHeader.getNextSibling().getNextSibling();
				gameHeaderTable = gameHeader.getFirstChild();
				
				awaytr = gameHeaderTable.getFirstChild().getNextSibling();
				hometr = awaytr.getNextSibling().getNextSibling(); //skip 1, between is records
				
				awayTmNmTd = awaytr.getFirstChild();
				awayTmScrTd = awayTmNmTd.getNextSibling();
				game.setAwayTeam(awayTmNmTd.getFirstChild().getFirstChild().getFirstChild().getText());
				String strAwScore = awayTmScrTd.getFirstChild().getFirstChild().getText();
				try{
					game.setAwayScore(Integer.parseInt(strAwScore));
					}
				catch(Exception e){
					game.setAwayScore(-1);
				}
				homeTmNmTd = hometr.getFirstChild();
				homeTmScrTd = homeTmNmTd.getNextSibling();
				game.setHomeTeam(homeTmNmTd.getFirstChild().getFirstChild().getFirstChild().getText());
				String strHmScore = homeTmScrTd.getFirstChild().getFirstChild().getText();
				try{
					game.setHomeScore(Integer.parseInt(strHmScore));
				}catch(Exception e){
					game.setHomeScore(-1);
				}
				
				// just replay links or null if no headline - headline is sometimes missing if game has concluded recently. ignore, not biggy.
				if(headlineDiv.getFirstChild().getFirstChild() != null){
					if(!headlineDiv.getFirstChild().getFirstChild().getText().equals("Watch&nbsp;Replay&nbsp;")){
						game.setHeadline(headlineDiv.getFirstChild().getFirstChild().getText());
					}
				}
				game.setGameDate(flatDate);
				
				if(game.getHomeScore() != -1 && game.getAwayScore() != -1){
					games.add(game);
				}
				//System.out.println(game.toString());
			} //close while iterator loop
		} catch (NumberFormatException e) {
			e.printStackTrace();
		} catch (ParserException e) {
			e.printStackTrace();
		} // try block
		return games;
	}
	private SportSeason getSportSeason(Date seasonDate, String option){
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Query query = pm.newQuery(SportSeason.class);
		SportSeason activeSportSeason = null;
		
		query.declareImports("import java.util.Date");
		query.declareParameters("Date inDate");
	    query.setFilter("sportType == \'NBA\' && dateBeg <= inDate");
	    try {
		    List<SportSeason> results = (List<SportSeason>) query.execute(seasonDate);
		    Iterator<SportSeason> iter = results.iterator();
	        if(iter.hasNext()) {
	        	SportSeason temp = iter.next();
	        	// reportDate less than or equal to endDate
	        	//System.out.println(temp.toString());
	        	if(seasonDate.compareTo(temp.getDateEnd())<=0){
	        		if((option.equals("active") && temp.getIsActive()) || option.equals("any")){
	        			activeSportSeason = temp;
	        		}
	        	}
	        }
	    } finally {
	    	query.closeAll();
        }
	    return activeSportSeason;
	}
}
