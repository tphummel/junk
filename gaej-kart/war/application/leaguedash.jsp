<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="javax.jdo.PersistenceManager" %>
<%@ page import="javax.jdo.Query" %>
<%@ page import="java.text.DateFormat" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="java.util.TimeZone" %>
<%@ page import="com.google.appengine.api.users.User" %>
<%@ page import="com.google.appengine.api.users.UserService" %>
<%@ page import="com.google.appengine.api.users.UserServiceFactory" %>
<%@ page import="com.google.appengine.api.datastore.Key" %>
<%@ page import="com.google.appengine.api.datastore.KeyFactory" %>
<%@ page import="triad.League" %>
<%@ page import="triad.Venue" %>
<%@ page import="triad.Player" %>
<%@ page import="triad.Season" %>
<%@ page import="triad.LeagueLogin" %>
<%@ page import="triad.PMF" %>

<%@include file="/templates/header.html" %>

<%

UserService userService = UserServiceFactory.getUserService();
User user = userService.getCurrentUser();
League league = new League();

if(!request.getParameterMap().containsKey("leagueid")){
	%>
	<div>No league selected.</div>
	<%
	return;
}

PersistenceManager pm = PMF.get().getPersistenceManager();

//league = pm.getObjectById(League.class, KeyFactory.stringToKey(request.getParameter("id")));
try{
	league = pm.getObjectById(League.class, KeyFactory.createKey(League.class.getSimpleName(), Long.parseLong(request.getParameter("leagueid"))));
}catch(Exception e){
	response.sendRedirect("/error.jsp?msg="+e.getMessage());
}

if(!league.checkUserIsMember(user)){
	%>
	<div>You are not authorized to view this league.</div>
	<%
	return;
}
%>
<div><a href="/app/home">User</a> > League</div>
<div style="margin-top: 10px;">Name: <%=league.getName() %></div>
<div style="font-weight:bold;">id: <%=league.getKey().getId() %></div>
<div style="font-weight:bold;">pass: <%=league.getPassword() %></div>
<div>owner: <%=league.getOwner().getNickname() %></div>
<div>
	<% 
	if (league.getUsers().isEmpty()) {
		%>
		<div>There are no other users in this league yet.</div>
		<%
	}else{
		for(User u : league.getUsers()) {
			%>
			<div>Authorized User: <%= u.getNickname() %></div>
			<%
		}
	}
	%>
</div>
<div style="margin-top: 10px;">Rules:<br />
		<%=league.getEngineClass() %> | <%=(league.hasBots()) ? "GP" : "VS" %> | <%=league.getNumberOfPlayers()+"P" %> | 
		<%=(league.getRacesPerCluster()==0) ? "No Cluster Race Limit " : league.getRacesPerCluster()+" Races per Cluster" %> | 
		<%=(league.getLapsPerRace()==0) ? "Reco" : league.getLapsPerRace() %> Laps | 
		<%=(league.getItemsSetting().equals("recommended")) ? "Reco" : league.getItemsSetting() %> Items
	</div>
	<div style="margin:10px;float:left;">
		<table><tr><th colspan="2">Win Pts</th></tr>
		<% for(int j=0;j<league.getWinPointValues().length; j++){ %>
		<tr><td><%=j+1 %></td><td><%=league.getWinPointValue(j)%></td></tr>
		<%} %>
		</table>
	
	</div>
	<div style="float:left;margin: 10px;"><table border="1"><tr><th>Seasons</th></tr>
		<%
		List<Season> seasons = league.getSeasons();
		if (seasons.isEmpty()){
			%><tr><td>No Seasons Yet.</td></tr><%
		}else{
			for(Season s : seasons){
				%><tr><td>#<%=s.getSeq()+": "%>
					<a href="/app/season/<%=league.getKey().getId() %>/<%=s.getKey().getId() %>"><%=s.getName() %></a>
				</td></tr><%
			}
		}
		%>
		<tr>
			<td>
				<form method="post" action="/app/leaguecrud">
					<input type="hidden" name="action" value="createseason" />
					<input type="hidden" name="league" value="<%= KeyFactory.keyToString(league.getKey()) %>" />
					<input type="hidden" name="seasonseq" value="<%=seasons.size()+1 %>" />
					<input type="text" size="8" name="seasonname" />
					<input type="submit" value="create season" />
				</form> 
			</td>
		</tr>
		</table>
	</div>
	<div style="float:left;margin: 10px;"><table border="1"><tr><th>Venues</th></tr>
		<%
		if (league.getVenues().isEmpty()){
			%><tr><td>No Venues Yet.</td></tr><%
		}else{
			for(Venue v : league.getVenues()){
				%><tr><td><%=v.getName() %></td></tr><%
			}
		}
		%>
		<tr>
			<td>
				<form method="post" action="/app/leaguecrud">
					<input type="hidden" name="action" value="createvenue" />
					<input type="hidden" name="league" value="<%= KeyFactory.keyToString(league.getKey()) %>" />
					<input type="text" size="8" name="venuename" />
					<input type="submit" value="create venue" />
				</form> 
			</td>
		</tr>
		</table>
	</div>
	<div style="float:left;margin: 10px;">
	<table border="1">
	<tr><th>Players</th></tr>
		<%
		if (league.getPlayers().isEmpty()){
			%>
				<tr>
					<td>No Players Yet.</td>
				</tr>
			<%
		}else{
			for(Player p : league.getPlayers()){
				%>
				<tr>
					<td><%=p.getName() %></td>
				</tr>
				<%
			}
		}
		%>
		<tr>
			<td>
				<form method="post" action="/app/leaguecrud">
					<input type="hidden" name="action" value="createplayer" />
					<input type="hidden" name="league" value="<%= KeyFactory.keyToString(league.getKey()) %>" />
					<input type="text" size="8" name="playername" />
					<input type="submit" value="create player" />
				</form> 
			</td>
		</tr>
		</table>
	</div>
	<div style="clear:left;float:left;margin:10px;">
	<%  
	DateFormat fullDateTime = new SimpleDateFormat("MM/dd/yyyy h:mm:ss a");
	fullDateTime.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));
	Query q = pm.newQuery("select from " + LeagueLogin.class.getName()+
			" where league == keyParam "+
			"parameters "+Key.class.getName()+" keyParam"+
			" order by date desc");
	q.setRange(0,5);
    List<LeagueLogin> logins = (List<LeagueLogin>)q.execute(league.getKey());
    %>
    <table><caption>Recent Logins</caption><tr><th>Time</th><th>User</th></tr>
    <%
    for(LeagueLogin login : logins){
    	%>
    	<tr><td><%= fullDateTime.format(login.getDate()) %></td>
    	<td><%=login.getUser().getNickname() %></td></tr>
    	<%
    }
    
    
    %>
    </table>
	</div>
<%@include file="/templates/footer.html" %>
