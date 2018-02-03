<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
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
<%@ page import="triad.Perf" %>
<%@ page import="triad.Match" %>
<%@ page import="triad.Cluster" %>
<%@ page import="triad.Standing" %>
<%@ page import="triad.PMF" %>


<%@include file="/templates/header.html" %>
<%

UserService userService = UserServiceFactory.getUserService();
User user = userService.getCurrentUser();
Cluster cluster = new Cluster();
PersistenceManager pm = PMF.get().getPersistenceManager();
DateFormat fullDateTime = new SimpleDateFormat("MM/dd/yyyy h:mm:ss a");
fullDateTime.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));
DateFormat timeOnly = new SimpleDateFormat("k:mm:ss");
timeOnly.setTimeZone(TimeZone.getTimeZone("America/Los_Angeles"));

if(!request.getParameterMap().containsKey("cluster") ){
	%>
	<div>No cluster selected.</div>
	<%
	return;
}

try{
	cluster = pm.getObjectById(Cluster.class, KeyFactory.stringToKey(request.getParameter("cluster")));
}catch(Exception e){
	if(e.getMessage()==null){
		response.sendRedirect("/error.jsp?msg=error building cluster for args in matchedit.jsp");
	}else{
		response.sendRedirect("/error.jsp?msg="+e.getMessage());
	}
}

if(!cluster.checkUserIsLeagueMember(user)){
	%>
	<div>You are not authorized to edit this match.</div>
	<%
	return;
}
if(request.getAttribute("message")!= null){
%>
<div style="color:red;"><%="Error: "+request.getAttribute("message") %></div>
<%} %>
<div id="match-form-container" style="clear:left;margin-top:15px;">
	<form method="post" action="/app/seasoncrud">
	<input type="hidden" name="action" value="creatematchandperfs" />
	<%if(request.getParameterMap().containsKey("match") ){ %>
		<input type="hidden" name="match" value="<%=request.getParameter("match")%>" />
	<%}%>
		<input type="hidden" name="cluster" value="<%= KeyFactory.keyToString(cluster.getKey()) %>" />
		<input type="hidden" name="matchseq" value="<%=cluster.getMatches().size()+1 %>" />
		<% 
		Match match;
		if(request.getParameterMap().containsKey("match")){
			match = pm.getObjectById(Match.class, KeyFactory.stringToKey(request.getParameter("match")));
		}else{
			match = new Match(
					cluster,
					new java.util.Date(),
					Integer.parseInt(request.getParameter("matchseq")),
					request.getParameter("course"),
					request.getParameter("notes"));
		}
		
		if(cluster.getLeagueCourses().length == 1){
			%>
			<input type="hidden" name="course" value="<%=cluster.getLeagueCourses()[0] %>" />
			<%
		}
		%>
	<table style="margin: 0 auto;"><caption>Update Match</caption>
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
							if(match.getCourse().equals(course)){
								out.print(" SELECTED");
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
		Perf perf;
		if(match.getPerfs().size()==0){
			String[] drivers = {request.getParameter("driver".concat(String.valueOf(i))),request.getParameter("rear".concat(String.valueOf(i)))};
			String playerKeyVal = request.getParameter("player".concat(String.valueOf(i)));
			perf = new Perf(
				match,
				(playerKeyVal.equals("-1")) ? null : KeyFactory.stringToKey(playerKeyVal),
				drivers,
				request.getParameter("kart".concat(String.valueOf(i))),
				Integer.parseInt(request.getParameter("finish".concat(String.valueOf(i))))
			);
		}else{
			perf = match.getPerfs().get(i-1);
		}
		%>
		<tr>
			<td rowspan="2">P<%=i%></td>
			<td>
				<select name="player<%=i%>">
					<option value="-1" <%=(perf.getPlayerKey()==null) ? " SELECTED" :"" %>>Select</option>
					<%
					for(Player p : cluster.getLeaguePlayers()){
						%>
						<option value="<%=KeyFactory.keyToString(p.getKey()) %>"
							<%
							if(perf.getPlayerKey().equals(p.getKey())){
								out.print(" SELECTED");
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
							if(perf.getDrivers()[0].equals(character)){
								out.print(" SELECTED");
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
							if(perf.getFinishPos()==j){
								out.print(" SELECTED");
							}
						%>><%=j%></option>
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
						if(perf.getKart().equals(kart)){
							out.print(" SELECTED");
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
						if(perf.getDrivers()[1].equals(character)){
							out.print(" SELECTED");
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
	<tr><td colspan="4"><fieldset><legend>Notes</legend><textarea name="notes" cols="35" rows="2"><%=match.getNotes()%></textarea></fieldset></td></tr>
	<tr><th colspan="4"><input type="submit" value="submit match" /></th></tr>
	</table>
	</form> 
</div>



<%@include file="/templates/footer.html" %>