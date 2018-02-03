package triad;

import java.io.IOException;
import javax.jdo.PersistenceManager;
import javax.jdo.Transaction;
import javax.servlet.http.*;

import java.util.List;

import com.google.appengine.api.datastore.KeyFactory;
import com.google.appengine.api.datastore.Text;
import com.google.appengine.api.users.User;
import com.google.appengine.api.users.UserService;
import com.google.appengine.api.users.UserServiceFactory;

import triad.League;
import triad.PMF;

import java.util.Properties;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.AddressException;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

public class CronServlet extends HttpServlet {

	/**
	 * 
	 */
	private static final long serialVersionUID = 1L;
	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
		
		// data cleaning functions		
		// send me full summary
		// compute record listings for active leagues
		
		this.doNightlyEmailForActiveLeagues();
			
		
	}
	private void doNightlyEmailForActiveLeagues(){
		List<User> usersToEmail;
		// get all leagues
		// check each league for new data in last 24 hours
		/*for(League league : ){
			 usersToEmail = league.getUsers();
			 usersToEmail.add(league.getOwner());
			 for(User user : usersToEmail){
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
		            msg.setSubject("KartDB - League "+league.getName());
		            msg.setText(msgBody);
		            Transport.send(msg);
		        }catch(Exception e){
		        	
		        }
			 }
		}*/
	}
}