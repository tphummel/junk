<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="java.util.Map" %>
<%@ page import="java.util.TimeZone" %>
<%@ page import="java.text.DateFormat" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="javax.jdo.PersistenceManager" %>
<%@ page import="javax.jdo.Query" %>

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
<%@ page import="triad.Standing" %>
<%@ page import="triad.PMF" %>

<%@include file="/templates/header.html" %>
<%

UserService userService = UserServiceFactory.getUserService();
User user = userService.getCurrentUser();
Season season = new Season();
DateFormat fullDateTime = new SimpleDateFormat("MM/dd/yyyy h:mm:ss a");
fullDateTime.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));
DateFormat timeOnly = new SimpleDateFormat("k:mm:ss");
timeOnly.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));


if(!request.getParameterMap().containsKey("leagueid") || 
		!request.getParameterMap().containsKey("seasonid")){
	%>
	<div>No season selected.</div>
	<%
	return;
}

PersistenceManager pm = PMF.get().getPersistenceManager();
try{
	season = pm.getObjectById(Season.class, 
		new KeyFactory.Builder(League.class.getSimpleName(), Long.parseLong(request.getParameter("leagueid")))
			.addChild(Season.class.getSimpleName(), Long.parseLong(request.getParameter("seasonid"))).getKey()
	);
	//season = pm.getObjectById(Season.class, KeyFactory.createKey(Season.class.getSimpleName(), Long.parseLong(request.getParameter("id"))));
}catch(Exception e){
	response.sendRedirect("/error.jsp?msg="+e.getMessage());
}

if(!season.checkUserIsLeagueMember(user)){
	%>
	<div>You are not authorized to view this season.</div>
	<%
	return;
}
%>
<%if(request.getParameterMap().containsKey("action")){
	if(request.getParameter("action").equals("showcoursereport")){
		%>
		<div>
			<a href="/app/home">User</a> > 
			<a href="/app/league/<%=season.getLeague().getKey().getId() %>">League</a> >
			<a href="/app/season/<%=season.getLeague().getKey().getId() %>/<%=season.getKey().getId() %>">Season</a> 
		</div>
		<div style="margin-top:10px;">Name: <%=season.getName() %></div>
		<div id="course-tables-containers" style="float:left;clear:right;margin:25px 0 0 5px;"><%
		Map<String, List<Standing>> coursesStandings =  season.getCoursesStandings();
		for(String course : season.getLeagueCourses()){
			if(coursesStandings.containsKey(course)){
				int standCols=4;
				List<Standing> standings = coursesStandings.get(course);
				%><div style="margin-bottom:15px;"class="course-standings" >
				<table><caption>Course: <%=course %></caption>
						<tr><th>Rk</th><th>Nm</th><th>#</th><th>WP</th>
						<%
						for(int k=1; k<=season.lookupLeagueRacersPerMatch(); k++){
							standCols++;
							%>
							<th><%=k %></th>
							<%
						}
						Key[] gapScoreColumnOrder = new Key[standings.size()];
						for(int n=0;n<standings.size();n++){
							gapScoreColumnOrder[n] = standings.get(n).getPlayerKey();
						%>
						<th><%=standings.get(n).getPlayerShortName() %></th>
						<%} %>
						</tr>
				<%
				if(standings.isEmpty()){
					%><tr><td colspan="<%=standCols %>">No Data Yet</td></tr><%
				}else{
					for(int u=0;u<standings.size();u++){
						%>
						<tr>
							<td><%=u+1 %></td>
							<td><%=standings.get(u).getPlayerShortName() %></td>
							<td><%=standings.get(u).getMatchesPlayed() %></td>
							<td><%=standings.get(u).getWinPoints() %></td>
							<%for(int p=0;p<season.lookupLeagueRacersPerMatch();p++){ 
								// GP game, place 3+, with 1+ result - highlight cell yellow
								%>
									<td <%=(season.checkLeagueHasBots() && p>1 && standings.get(u).getFinishesByPlace()[p]>0) ? 
											" style=\"background-color:FFFF99 \"" : "" %>>
										<%=standings.get(u).getFinishesByPlace()[p] %>
									</td>
							<% } %>
							<% for(int k=0;k<standings.size();k++){ 
								if(!standings.get(u).getGapScores().containsKey(gapScoreColumnOrder[k])){ %>
								<td>na</td>
								<%}else{ 
									Integer gapScore = standings.get(u).getGapScores().get(gapScoreColumnOrder[k])[1];
								%>
								<td><%= ((gapScore>0)?"+":"")+Integer.valueOf(gapScore) %></td>
								<%} %>
							<%} %>
						</tr>
						<%
					}
				}
				%>
				</table>
				</div>
				<%
			}
		}
		%>
		</div>
		<%
		}
	%>
	<%@include file="/templates/footer.html" %>
	<%
	return;
	}
 %>
<% int standingCols=4; %>
<div>
	<a href="/app/home">User</a> > 
	<a href="/app/league/<%=season.getLeague().getKey().getId() %>">League</a> >
	Season
</div>
<div style="margin-top:10px;">Name: <%=season.getName() %></div>
<div style="margin-top: 25px;padding:15px;clear:both;">
	<table border="1" cellpadding="5"><caption>Season Standings</caption>
		<tr><th>Plc</th><th>Name</th><th>Races</th><th>Pts</th>
		<%
		for(int k=1; k<=season.lookupLeagueRacersPerMatch(); k++){
			standingCols++;
			%>
			<th><%=k %></th>
			<%
		}
		%>
		</tr>
	<% if(season.getClusters().isEmpty()){
		%><tr><td colspan="<%=standingCols %>">Standings will be shown here once a Cluster has been played.</td></tr><%
	}else{
		List<Standing> standings = season.getStandings();
		
		for(int u=0;u<standings.size();u++){
			%>
			<tr>
				<td><%=u+1 %></td>
				<td><%=standings.get(u).getPlayerObject().getName() %></td>
				<td><%=standings.get(u).getMatchesPlayed() %></td>
				<td><%=standings.get(u).getWinPoints() %></td>
				<%for(int p=0;p<season.lookupLeagueRacersPerMatch();p++){ 
					%>
						<td><%=standings.get(u).getFinishesByPlace()[p]%>
						</td>
				<% } %>
			</tr>
			<%
		}
		%>
	<%} %>
	</table>
</div>
<% if(season.getLeagueCourses().length>1){ %>
<div style="margin:10px;">
	<a href="/app/season/<%=season.getLeague().getKey().getId() %>/<%=season.getKey().getId() %>/coursereport">Show Course Breakdown</a>
</div>
<%} %>
<div style="padding:15px;margin-top:10px;float:left;"><table border="1"><tr><th>Clusters</th></tr>
	<%
	List<Cluster> clusters = season.getClusters();
	if (clusters.isEmpty()){
		%><tr><td>No Clusters Yet.</td></tr><%
	}else{
		int i=1;
		for(Cluster c : clusters){
			%><tr><td>#<%=i%>: 
				<a href="/app/cluster/<%=c.getLeague().getKey().getId() %>/<%=c.getSeason().getKey().getId() %>/<%=c.getKey().getId() %>">
				<%= fullDateTime.format(c.getStartDate()) %></a>
			</td></tr><%
			i++;
		}
	}
	%>
	</table>
</div>
<div style="padding: 15px;margin-top: 10px;float:left;">
	<form method="post" action="/app/seasoncrud">
		<input type="hidden" name="action" value="createcluster" />
		<input type="hidden" name="season" value="<%= KeyFactory.keyToString(season.getKey()) %>" />
		<input type="hidden" name="clusterseq" value="<%=clusters.size()+1 %>" />
		Venue:<select name="venue">
			<%
			for(Venue v : season.getLeagueVenues()){
				%>
				<option value="<%=KeyFactory.keyToString(v.getKey()) %>"><%=v.getName() %></option>
				<%
			}
			%>
		</select>
		<input type="submit" value="start new cluster" />
	</form> 
</div>
<%@include file="/templates/footer.html" %>