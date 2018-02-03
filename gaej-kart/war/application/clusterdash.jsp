<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="java.util.Collections" %>
<%@ page import="java.util.Iterator" %>
<%@ page import="java.text.DateFormat" %>
<%@ page import="java.text.SimpleDateFormat" %>
<%@ page import="java.util.TimeZone" %>
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
<%@ page import="triad.Match" %>
<%@ page import="triad.Perf" %>
<%@ page import="triad.PMF" %>
<%@ page import="triad.Standing" %>

<%@include file="/templates/header.html" %>

<%
UserService userService = UserServiceFactory.getUserService();
User user = userService.getCurrentUser();
PersistenceManager pm = PMF.get().getPersistenceManager();
Cluster cluster = new Cluster();

Match lastMatch = new Match();
DateFormat fullDateTime = new SimpleDateFormat("MM/dd/yyyy h:mm:ss a");
fullDateTime.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));
DateFormat timeOnly = new SimpleDateFormat("k:mm:ss");
timeOnly.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));

if(!request.getParameterMap().containsKey("leagueid") || 
		!request.getParameterMap().containsKey("seasonid") ||
		!request.getParameterMap().containsKey("clusterid") ){
	%>
	<div>No cluster selected.</div>
	<%
	return;
}

try{
	cluster = pm.getObjectById(Cluster.class, 
			new KeyFactory.Builder(League.class.getSimpleName(), Long.parseLong(request.getParameter("leagueid")))
				.addChild(Season.class.getSimpleName(), Long.parseLong(request.getParameter("seasonid")))
				.addChild(Cluster.class.getSimpleName(), Long.parseLong(request.getParameter("clusterid"))).getKey()
		);
}catch(Exception e){
	response.sendRedirect("/error.jsp?msg="+e.getMessage());
}

Venue venue = cluster.getVenueObject();
/*List<Match> matches = cluster.getMatches();
Season season  = cluster.getSeason();;
League league = season.getLeague();*/

if (!cluster.getMatches().isEmpty()){
	lastMatch = cluster.getMatches().get(cluster.getMatches().size()-1);
}

if(!cluster.checkUserIsLeagueMember(user)){
	%>
	<div>You are not authorized to view this cluster.</div>
	<%
	return;
}

%>
<div id="left-body" style="clear:left;float:left;padding:15px;">
	<div id="breadcrumb">
		<a href="/app/home">User</a> > 
		<a href="/app/league/<%=cluster.getLeague().getKey().getId() %>">League</a> >
		<a href="/app/season/<%=cluster.getLeague().getKey().getId() %>/<%=cluster.getSeason().getKey().getId() %>">Season</a> >
		Cluster
	</div>
	<div style="margin-top: 10px;">Season: <%=cluster.getSeason().getName()  %></div>
	<div>Cluster Created: <%= fullDateTime.format(cluster.getStartDate()) %></div>
	<div>Cluster#: <%= cluster.getSeq() %></div>
	<div>Venue: <%= venue.getName() %></div>
	<div>Mode:
	<% 
	if(cluster.checkIsLeagueOfficial()){
		Integer matchesLeft = cluster.getNumberOfMatchesRemaining(); 
		
		out.print(matchesLeft+" Match(es) Remaining");
		
	}else{
		out.print("Free Play");
	} %>
	</div>
	<div>Cluster Status: <%=(cluster.getActiveFlag())?"Active":"Complete" %></div>
	
	
	
	<div id="match-form-container" style="clear:left;margin-top:15px;">
	<%if(!cluster.getActiveFlag()){ %>
		This Cluster is complete.<br /> It can no longer accept new races.<br />
		Go back to the <a href="/app/season/<%=cluster.getKey().getParent().getParent().getId() %>/<%=cluster.getKey().getParent().getId() %>">Season Dashboard</a><br />
		
	
	<%}else{ %>
		<form method="post" action="/app/seasoncrud">
			<input type="hidden" name="action" value="creatematchandperfs" />
			<input type="hidden" name="cluster" value="<%= KeyFactory.keyToString(cluster.getKey()) %>" />
			<input type="hidden" name="matchseq" value="<%=cluster.getMatches().size()+1 %>" />
			<% 
		
			Boolean previousMatchExists = false;
			if(!lastMatch.getPerfs().isEmpty()){
				previousMatchExists = true;
			}
			
			if(cluster.getLeagueCourses().length == 1){
				%>
				<input type="hidden" name="course" value="<%=cluster.getLeagueCourses()[0] %>" />
				<%
			}
			%>
		<table><caption>Enter New Match</caption>
		<tr>
			<th colspan="4">Course:
			<% if(cluster.getLeagueCourses().length == 1){
				%>
				<%=cluster.getLeagueCourses()[0] %>
				
				<%
			}else{
			%>
				<select name="course">
					<%
					for(String course : cluster.getLeagueCourses()){
						%>
						<option value="<%= course %>"
							<%
							if(previousMatchExists){
								if(lastMatch.getCourse().equals(course)){
									out.print(" SELECTED");
								}
							}
							%>
						><%= course %></option>
						<%
					}
					%>
				</select>
			<% } %>
			</th>
		</tr>
		<tr><th>P#</th><th>Player/Kart</th><th>Driver/Rear</th><th>Finish</th>
		</tr>
		
		<%
		
		for(int i=1;i<=cluster.getNumberOfPlayersPerRace();i++){
			Perf lastPerf = new Perf();
			if(previousMatchExists){
				lastPerf = lastMatch.getPerfs().get(i-1);
			}
			%>
			<tr>
				<td rowspan="2">P<%=i%></td>
				<td>
					<select name="player<%=i%>">
						<option value="-1">Select</option>
						<%
						for(Player p : cluster.getLeaguePlayers()){
							%>
							<option value="<%=KeyFactory.keyToString(p.getKey()) %>"
								<%
								if(previousMatchExists){
									if(lastPerf.getPlayerKey().equals(p.getKey())){
										out.print(" SELECTED");
									}
								}
								%>><%=p.getName() %>
							</option>
							<%
						}
						%>
					</select>
				</td>
				<td>
					<select name="driver<%=i %>">
						<option value="-1">Select</option>
						<%
						for(String character : League.DRIVERS){
							%>
							<option value="<%=character%>" 
								<%
									if(previousMatchExists){
										if(lastPerf.getDrivers()[0].equals(character)){
											out.print(" SELECTED");
										}
									}
								%>><%=character%>
							</option>
							<%
						}
						%>
					</select>
				</td>
				
				<td rowspan="2">
					<select name="finish<%=i %>">
						<option value="-1">Pos</option>
						<%
						// reset finish pos to default each match
						for(int j=1;j<=cluster.getNumberOfRacersPerMatch();j++){
							%>
							<option value="<%=j%>"
								<%
									if(previousMatchExists){
										if(lastPerf.getFinishPos()==j){
											out.print(" SELECTED");
										}
									}
								%>	
							><%=j%></option>
							<%
						}
						%>
					</select>
				</td>
				
			</tr>
			<tr>
				<td>
					<select name="kart<%=i %>">
						<option value="-1">Select</option>
						<%
						for(String kart : League.KARTS){
							%>
							<option value="<%=kart%>"
							<%
							if(previousMatchExists){
								if(lastPerf.getKart().equals(kart)){
									out.print(" SELECTED");
								}
							}
							%>
							><%=kart%></option>
							<%
						}
						%>
					</select>
				</td>
				<td>
					<select name="rear<%=i %>">
						<option value="-1">Select</option>
						<%
						for(String character : League.DRIVERS){
							%>
							<option value="<%=character%>"
							<%
								if(previousMatchExists){
									if(lastPerf.getDrivers()[1].equals(character)){
										out.print(" SELECTED");
									}
								}
							%>
							><%=character%></option>
							<%
						}
						%>
					</select>
				</td>
			</tr>
			<%
		} // close Player Rows Loop
		
		%>
		<tr><td colspan="4"><fieldset><legend>Notes</legend><textarea name="notes" cols="35" rows="2"></textarea></fieldset></td></tr>
		<tr><th colspan="4"><input type="submit" value="submit match" /></th></tr>
		</table>
		</form> 
	<%} %>
	</div>
</div>

<div id="right-body" style="float:left;clear:right;margin:25px 0 0 5px;">
<% int clustStandCols=4; %>
	<div id="cluster-standings" >
	<table><caption>Cluster Standings</caption>
			<tr><th>Rk</th><th>Nm</th><th>#</th><th>WP</th>
			<%
			for(int k=1; k<=cluster.getNumberOfRacersPerMatch(); k++){
				clustStandCols++;
				%>
				<th><%=k %></th>
				<%
			}
			List<Standing> standings = cluster.getStandings();
			Key[] gapScoreColumnOrder = new Key[standings.size()];
			for(int n=0;n<standings.size();n++){
				gapScoreColumnOrder[n] = standings.get(n).getPlayerKey();
			%>
			<th><%=standings.get(n).getPlayerShortName() %></th>
			<%} %>
			</tr>
		<% 
		if(standings.isEmpty()){
			%><tr><td colspan="<%=clustStandCols %>">No Data Yet</td></tr><%
		}else{
			
			
			for(int u=0;u<standings.size();u++){
				
				%>
				<tr>
					<td><%=u+1 %></td>
					<td><%=standings.get(u).getPlayerShortName() %></td>
					<td><%=standings.get(u).getMatchesPlayed() %></td>
					<td><%=standings.get(u).getWinPoints() %></td>
					<%for(int p=0;p<cluster.getNumberOfRacersPerMatch();p++){ 
						// GP game, place 3+, with 1+ result - highlight cell yellow
						%>
							<td <%=(cluster.getSeason().checkLeagueHasBots() && p>1 && standings.get(u).getFinishesByPlace()[p]>0) ? 
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
		} %>
		</table>
	</div>
	<div id="match-listing" style="clear:both;margin-top:15px;">
		<table><caption>Matches</caption>
			<tr><th>#</th><th>Time</th>
			<%if(cluster.getLeagueCourses().length>1){ %>
			<th>Course</th>
			<% 
			}
			int matchTotCols = 3;
			int perPlaceCols = 0;
			if(cluster.checkLeagueHasBots()){
				perPlaceCols = 2;
				matchTotCols += 2;
			}
			for(int i=1; i <= cluster.getNumberOfPlayersPerRace(); i++){
				// 2 columns per player when using computer bots. allow for name and place
				%>
				<th colspan="<%= perPlaceCols %>"><%=i %></th>
				<%
				matchTotCols += perPlaceCols;
				
			}
			%>
			</tr>
			<%
			if (cluster.getMatches().isEmpty()){
				%><tr><td colspan="<%=matchTotCols %>">No Matches Yet.</td></tr><%
			}else{
				Match match;
				List<Match> matches = cluster.getMatches();
				int start = matches.size()-1;
				int end;
				if(cluster.getActiveFlag()){
					if(matches.size() > 15){
						end = matches.size()-15;
					}else{
						end = 0;
					}
				}
				else{
					// show all records regardless of size if cluster is finished
					end = 0;
				}
				for(int m = start; m>=end; m--){
					match = matches.get(m);
					%><tr>
						<td><%=m+1%></td>
						<td><%=timeOnly.format(match.getSubmitDate()) %></td>
						<%if(cluster.getLeagueCourses().length>1){ %>
						<td><%=match.getCourse() %></td>
						<%
						}
						// sort order is by finish pos
						List<Perf> perfs = match.getPerfs();
						Collections.sort(perfs);
						for(Perf p : perfs){
							%>
							<td><%=p.getShortPlayerName()%></td>
							<% if(cluster.checkLeagueHasBots()){%>
							<td><%= p.getFinishPos() %></td>
							<%}
						}
						if(m==start){
						%>
						<td><form method="post" action="/app/seasoncrud" style="margin:0px;">
							<input type="hidden" name="action" value="deletematchandperfs" />
							<input type="hidden" name="match" value="<%=KeyFactory.keyToString(match.getKey()) %>" />
							<input type="hidden" name="cluster" value="<%=KeyFactory.keyToString(cluster.getKey()) %>" />
							<input type="submit" value="X" style="margin:0px;padding:0px 3px;"/>
						</form></td>
						<%}else{ %>
						<td>&nbsp;</td>
						<%} %>
						
						<%if(match.getNotes().length()==0){%>
							<td>&nbsp;</td>
						<%}else{%>
							<td><acronym title="<%=match.getNotes() %>">Note</acronym></td>
						<%} %>
						<td><form method="post" action="/app/match" style="margin:0px;">
							<input type="hidden" name="action" value="deletematchandperfs" />
							<input type="hidden" name="match" value="<%=KeyFactory.keyToString(match.getKey()) %>" />
							<input type="hidden" name="cluster" value="<%=KeyFactory.keyToString(cluster.getKey()) %>" />
							<input type="submit" value="edit" style="margin:0px;padding:0px 3px;"/>
						</form></td>
					</tr><%
				}
			}
			%>
		</table>
	</div>
</div>
<%@include file="/templates/footer.html" %>