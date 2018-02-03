<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="java.util.Collections" %>
<%@ page import="java.text.DateFormat" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="java.util.TimeZone" %>
<%@ page import="java.util.Iterator" %>
<%@ page import="javax.jdo.PersistenceManager" %>
<%@ page import="javax.jdo.Query" %>
<%@ page import="javax.jdo.Extent" %>

<%@ page import="com.google.appengine.api.users.User" %>
<%@ page import="com.google.appengine.api.users.UserService" %>
<%@ page import="com.google.appengine.api.users.UserServiceFactory" %>
<%@ page import="com.google.appengine.api.datastore.Key" %>
<%@ page import="com.google.appengine.api.datastore.KeyFactory" %>
<%@ page import="triad.League" %>
<%@ page import="triad.Venue" %>
<%@ page import="triad.Player" %>
<%@ page import="triad.Season" %>
<%@ page import="triad.Cluster" %>
<%@ page import="triad.Match" %>
<%@ page import="triad.Perf" %>
<%@ page import="triad.PMF" %>
<%@ page import="triad.Standing" %>

<%@include file="/templates/header.html" %>

<%
UserService userService = UserServiceFactory.getUserService();
User user = userService.getCurrentUser();
PersistenceManager pm = PMF.get().getPersistenceManager();

%>
Admin Console<br />
Logged in as: <%= user.getNickname() %>
<%
DateFormat fullDateTime = new SimpleDateFormat("MM/dd/yyyy h:mm:ss a");
fullDateTime.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));
/*Query q = pm.newQuery("select from " + League.class.getName()+
		" where league == keyParam "+
		"parameters "+Key.class.getName()+" keyParam"+
		" order by date desc");
q.setRange(0,5);*/
Extent<League> leagues = pm.getExtent(League.class, false);
//List<League> logins = (List<League>)q.execute(league.getKey());
%>
<table style="font-size:0.8em;"><caption>Leagues</caption>
<tr>
	<th>Off</th><th>Id</th><th>Name</th><th>Pass</th><th>Owner</th>
	<th>Eng</th><th>Item</th><th><acronym title="Human Racers per Match">Hum</acronym></th><th><acronym title="Total Racers per Match">Tot</acronym></th>
	<th><acronym title="Laps Per Match">Lap</acronym></th><th><acronym title="Races per Cluster">Lmt</acronym></th><th>Win Pts</th>
	<th>Crs</th><th>Usr</th><th>Ply</th><th>Ven</th><th>Sea</th><th>Log</th>
	<th colspan="2">Del</th>
	
</tr>
<%
for(League league : leagues){
	%>
	<tr>
		<td><%=(league.isOfficial())?"O":"U" %></td>
		<td><%= league.getKey().getId() %>
		<td><%= league.getName() %></td>
		<td><%= league.getPassword() %></td>
		<td><%= league.getOwner().getNickname() %></td>
		<td><%= league.getEngineClass()%></td>
		<td><%= league.getItemsSetting().substring(0,3)%></td>
		<td><%= league.getNumberOfPlayers()%></td>
		<td><%= league.getNumberOfTotalRacers()%></td>
		<td><%= (league.getLapsPerRace()==0)?"Reco":league.getLapsPerRace()%></td>
		<td><%= (league.getRacesPerCluster()==0)?"NL":league.getRacesPerCluster()%></td>
		<td><% for(int g=0;g<league.getWinPointValues().length;g++){ %>
			<%=league.getWinPointValues()[g]+((league.getWinPointValues().length-g > 1)?",":"")  %>
		<%} %>
		</td>
		
		<td><%= league.getCourses().length %></td>
		<td><%= league.getUsers().size() %></td>
		<td><%= league.getPlayers().size() %></td>
		<td><%= league.getVenues().size() %></td>
		<td><%= league.getSeasons().size() %></td>
		<td><%= league.getLogins().size() %></td>
		
		
		<td><form method="post" action="/app/leaguecrud" style="margin:0px;">
		<input type="hidden" name="action" value="deleteleague"/>
		<input type="hidden" name="league" value="<%=KeyFactory.keyToString(league.getKey()) %>"/>
		<input style="margin:0px;padding:0px 3px;font-size:0.8em" type="submit" value="del"/></td>
		<td><input style="margin:0px;" type="checkbox" name="confirm" value="<%=KeyFactory.keyToString(league.getKey())%>"/></td>
		</form>
		</tr>
	<%
}
%>
</table>

<%@include file="/templates/footer.html" %>









