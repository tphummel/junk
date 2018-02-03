package triad;

import java.io.IOException;

import javax.jdo.PersistenceManager;
import javax.jdo.Transaction;
import javax.servlet.http.*;
import javax.servlet.RequestDispatcher;
import javax.servlet.ServletException;

import java.util.Date;
//import java.util.Calendar;
//import java.util.Locale;
//import java.util.TimeZone;

import com.google.appengine.api.datastore.KeyFactory;
//import com.google.appengine.api.datastore.Key;
import com.google.appengine.api.datastore.Text;
import com.google.appengine.api.users.User;
import com.google.appengine.api.users.UserService;
import com.google.appengine.api.users.UserServiceFactory;

public class SeasonCRUDServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;

	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
		UserService userService = UserServiceFactory.getUserService();
		User user = userService.getCurrentUser();
		String action;
		
		// check user is logged in.
		// still need to check user against league.checkUserIsMember()
		if (user == null){
			resp.sendRedirect("/app/home");
			return;
		}
		
		if(req.getParameterMap().containsKey("action")){
			action = req.getParameter("action");
			PersistenceManager pm = PMF.get().getPersistenceManager();
			if (action.equals("createcluster")){
				Season season = pm.getObjectById(Season.class, KeyFactory.stringToKey(req.getParameter("season")));
				Cluster cluster = new Cluster(
					season,
					KeyFactory.stringToKey(req.getParameter("venue")),
					new Date(),
					Integer.parseInt(req.getParameter("clusterseq"))
				);
				season.addCluster(cluster);
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					pm.makePersistent(season);
					tx.commit();
				}finally{
					if(tx.isActive()){
						tx.rollback();
					}
					pm.close();
				}
				//League league = pm.getObjectById(League.class, pm.getObjectById(League.class,season.getKey().getParent()));
				Long sKey = season.getKey().getId();
				Long lKey = season.getKey().getParent().getId();
				resp.sendRedirect("/app/season/"+lKey+"/"+sKey);
				//Cluster savedCluster = season.getClusters().get(season.getClusters().size()-1);
				//resp.sendRedirect("/app/cluster/"+savedCluster.getLeague().getKey().getId()+"/"+savedCluster.getSeason().getKey().getId()+"/"+savedCluster.getKey().getId());
			}// close create cluster
			else if(action.equals("deletematchandperfs")){
				Match match = pm.getObjectById(Match.class, KeyFactory.stringToKey(req.getParameter("match")));
				Cluster cluster = pm.getObjectById(Cluster.class, KeyFactory.stringToKey(req.getParameter("cluster")));
				Transaction tx = pm.currentTransaction();
				try{
					tx.begin();
					cluster.removeMatch(match);
					pm.deletePersistent(match);
					tx.commit();
				}catch(Exception e){
					resp.sendRedirect("/error.jsp?msg="+e.getMessage());
					return;
				}finally{
					if(tx.isActive()){
						tx.rollback();
					}
					pm.close();
				}
				Long leagueId = cluster.getKey().getParent().getParent().getId();
				Long seasonId = cluster.getKey().getParent().getId();
				Long clusterId = cluster.getKey().getId();
				resp.sendRedirect("/app/cluster/"+leagueId+"/"+seasonId+"/"+clusterId);
			}// close delete match and perfs
			else if (action.equals("creatematchandperfs")){
				Perf perf;
				Cluster cluster = pm.getObjectById(Cluster.class, KeyFactory.stringToKey(req.getParameter("cluster")));
				Match match = new Match();
				if(req.getParameterMap().containsKey("match")){
					match = pm.getObjectById(Match.class, KeyFactory.stringToKey(req.getParameter("match")));
					match.setCourse(req.getParameter("course"));
					match.setNotes(req.getParameter("notes"));
					match.clearPerfs();
				}else{
					match = new Match(
						cluster,
						new Date(),
						Integer.parseInt(req.getParameter("matchseq")),
						req.getParameter("course"),
						req.getParameter("notes"));
				}
				
				for(int x=1;x<=cluster.getSeason().getLeague().getNumberOfPlayers();x++){
					
					String[] drivers = {req.getParameter("driver"+String.valueOf(x)),req.getParameter("rear"+String.valueOf(x))};
					try{
						perf = new Perf(
							match,
							req.getParameter("player"+String.valueOf(x)),
							drivers,
							req.getParameter("kart"+String.valueOf(x)),
							Integer.parseInt(req.getParameter("finish"+String.valueOf(x)))
						);
						match.addPerf(perf);
					}catch(MatchException me){
						try {
							req.setAttribute("message", me.getMessage());
							RequestDispatcher rd = req.getRequestDispatcher("/application/matchedit.jsp");
							rd.forward(req, resp);
							//System.out.print("matchexception");
							//resp.sendRedirect("/app/match");
							return;
						} catch (ServletException e) {
							resp.sendRedirect("/error.jsp?msg="+e.getMessage());
							return;
						}
					}
				}
				try{
					if(match.getKey()==null){
						cluster.addMatch(match);
					}
				}catch(Exception e){
					resp.sendRedirect("/error.jsp?msg="+e.getMessage());
					return;
				}finally{
					pm.close();
				}				
				resp.sendRedirect("/app/cluster/"+cluster.getLeague().getKey().getId()+"/"+cluster.getSeason().getKey().getId()+"/"+cluster.getKey().getId());
			} // close if action = create match and perfs
		}//close if action param exists in request
	}
}
