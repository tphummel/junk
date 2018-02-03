package triad;

import java.io.IOException;
import javax.jdo.PersistenceManager;
import javax.jdo.Transaction;
import javax.servlet.http.*;
import java.util.Date;

import com.google.appengine.api.datastore.KeyFactory;
import com.google.appengine.api.datastore.Text;
import com.google.appengine.api.users.User;
import com.google.appengine.api.users.UserService;
import com.google.appengine.api.users.UserServiceFactory;

import triad.League;
import triad.PMF;

import java.util.Properties;
//import java.util.Map;
//import java.util.HashMap;
import javax.mail.Message;
//import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Transport;
//import javax.mail.internet.AddressException;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

public class LeagueCRUDServlet extends HttpServlet {

	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
		UserService userService = UserServiceFactory.getUserService();
		User user = userService.getCurrentUser();
		String action = "";
		League league = new League();
		
		// check user is logged in.
		// still need to check user against league.checkUserIsMember()
		if (user == null){
			resp.sendRedirect("/app/home");
			return;
		}
		
		if(req.getParameterMap().containsKey("action")){
			action = req.getParameter("action");
			PersistenceManager pm = PMF.get().getPersistenceManager();
			if (action.equals("create")){
				Integer[] winPointValues;
				Integer numTotalRacers = 0;
				if(req.getParameter("gamemode").equals("grandprix")){
					// GP adds 8-players bots to reach 8 total racers
					numTotalRacers = 8;
					
				}else if(req.getParameter("gamemode").equals("versus")){
					// VS doesn't add bots, players only
					numTotalRacers = Integer.parseInt(req.getParameter("numplayers"));
				}
				winPointValues = League.computeNewWinPointArray(numTotalRacers, Integer.parseInt(req.getParameter("numplayers")));
				
				league = new League(
					req.getParameter("name"),
					req.getParameter("pass"),
					new Text(req.getParameter("specifications")),
					req.getParameter("engine"),
					Integer.parseInt(req.getParameter("numplayers")),
					numTotalRacers,
					Integer.parseInt(req.getParameter("numraces")),
					Integer.parseInt(req.getParameter("numlaps")),
					req.getParameter("items"),
					req.getParameterValues("courses"),
					user,
					winPointValues
				);
				
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					pm.makePersistent(league);
					tx.commit();
				}finally{
					if(tx.isActive()){
						tx.rollback();
						pm.close();
					}
				}
				
				Properties props = new Properties();
		        Session session = Session.getDefaultInstance(props, null);

		        String msgBody = "You successfully created your Kart DB League. Here are the league login credentials." +
		        		"League ID: " +league.getKey().getId()+" League Password: "+league.getPassword()+
		        		" Anyone you give the ID and password to can join the league. However, only you as the owner" +
		        		"will have full administration rights - such as changing the password or deleting the League." +
		        		"Happy karting";
		        try{
			        Message msg = new MimeMessage(session);
		            msg.setFrom(new InternetAddress("tphummel@gmail.com", "Admin"));
		            msg.addRecipient(Message.RecipientType.TO,
		                             new InternetAddress(user.getEmail(), user.getNickname()));
		            msg.setSubject("Your Kart DB League Was Created");
		            msg.setText(msgBody);
		            Transport.send(msg);
		        }catch(Exception e){
		        	resp.sendRedirect("/error.jsp?msg=league+created+successfully+but+mailerror+leagueid+"+league.getKey().getId()+e.getMessage());
		        }
				
				resp.sendRedirect("/app/league/"+String.valueOf(league.getKey().getId()));
				return;
			}else if(action.equals("access")){
				try{
					league = pm.getObjectById(League.class, KeyFactory.createKey(League.class.getSimpleName(), Long.parseLong(req.getParameter("league"))));
				}catch(Exception e){
					resp.sendRedirect("/error.jsp?msg="+e.getMessage());
				}
				if(!req.getParameter("leaguepass").equals(league.getPassword())){
					resp.sendRedirect("/error.jsp?msg=league+password+incorrect");
					return;
				}
				league.addLogin(new LeagueLogin(
						league,user,new Date())
				);
				
				if(league.checkUserIsMember(user)){
				    // recompute, persist winPointValues on successful league login
//					Integer[] winPointValues = League.computeNewWinPointArray(league.getNumberOfTotalRacers(), league.getNumberOfPlayers());
//					try {
//				    	league.setWinPointValues(winPointValues);
//				    } finally {
//				        pm.close();
//				    }
					pm.close();
					resp.sendRedirect("/app/league/"+league.getKey().getId());
					return;
				}else{
					league.addUser(user);
					Transaction tx = pm.currentTransaction();
					try{
						tx.begin();
						pm.makePersistent(league);
						tx.commit();
					}finally{
						if(tx.isActive()){
							tx.rollback();
							pm.close();
							resp.sendRedirect("/error.jsp?msg=error+adding+user+to+league");
							return;
						}
						pm.close();
					}
					resp.sendRedirect("/app/league/"+String.valueOf(league.getKey().getId()));
					return;
				}
			}else if(action.equals("createvenue")){
				league = pm.getObjectById(League.class, KeyFactory.stringToKey(req.getParameter("league")));
				
				Venue v = new Venue(
					league,
					req.getParameter("venuename")
				);
				// wrap in tx b/c persist League & Venue are two separate actions. one could fail.
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					league.addVenue(v);
					pm.makePersistent(v);
					tx.commit();
				} finally{
					if(tx.isActive()){
						tx.rollback();
					}
					pm.close();
				}
				resp.sendRedirect("/app/league/"+String.valueOf(league.getKey().getId()));
				return;
			}// close create venue
			else if(action.equals("createplayer")){
				league = pm.getObjectById(League.class, KeyFactory.stringToKey(req.getParameter("league")));
				
				Player p = new Player(
					league,
					req.getParameter("playername")
				);
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					
					league.addPlayer(p);
					pm.makePersistent(league);
					
					tx.commit();
				} finally{
					if(tx.isActive()){
						tx.rollback();
					}
					pm.close();
				}
				resp.sendRedirect("/app/league/"+String.valueOf(league.getKey().getId()));
				return;
			}// close create player
			else if(action.equals("createseason")){
				league = pm.getObjectById(League.class, KeyFactory.stringToKey(req.getParameter("league")));
				
				Season s = new Season(
					league,
					req.getParameter("seasonname"),
					Integer.parseInt(req.getParameter("seasonseq"))
				);
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					league.addSeason(s);
					pm.makePersistent(league);
					tx.commit();
				} finally{
					if(tx.isActive()){
						tx.rollback();
					}
					pm.close();
				}
				resp.sendRedirect("/app/league/"+String.valueOf(league.getKey().getId()));
				return;
			}// close create season
			else if(action.equals("deleteleague")){
				if(req.getParameter("league").compareTo(req.getParameter("confirm"))==0){
					League dLeague = pm.getObjectById(League.class, KeyFactory.stringToKey(req.getParameter("league")));
					Transaction tx = pm.currentTransaction();
					try{
						tx.begin();
						pm.deletePersistent(dLeague);
						tx.commit();
					}finally{
						if(tx.isActive()){
							tx.rollback();
						}
						pm.close();
					}
					resp.sendRedirect("/admin/admindash.jsp");
					return;
				}
				
				
			}// end delete league
		}// close if paramkey exists "action"
		resp.sendRedirect("/app/home");
		return;
	}
}
