<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="javax.jdo.PersistenceManager" %>
<%@ page import="com.google.appengine.api.datastore.KeyFactory" %>
<%@ page import="com.google.appengine.api.users.User" %>
<%@ page import="com.google.appengine.api.users.UserService" %>
<%@ page import="com.google.appengine.api.users.UserServiceFactory" %>
<%@ page import="triad.League" %>
<%@ page import="triad.PMF" %>

<%@include file="/templates/header.html" %>
<%
	UserService userService = UserServiceFactory.getUserService();
	User user = userService.getCurrentUser();
	%><div style="margin-bottom: 10px;">
			Hello, <%= user.getNickname() %>. 
			- <a href="<%= userService.createLogoutURL(request.getRequestURI()) %>">sign out</a>
		</div>
		<div style="margin:20px 0px;">
			<form action="/app/leaguecrud" method="post">
				<input type="hidden" name="action" value="access" />
				<table>
					<tr><td>League ID:</td><td><input type="text" name="league" /></td></tr>
					<tr><td>Password:</td><td><input type="password" name="leaguepass" /></td></tr>
					<tr><td>&nbsp;</<td><input type="submit" value="Access League" /></td></tr>
				</table>
			</form>
		</div>
			
		<div style="margin-top: 30px;">
			<form action="/app/leaguecrud" method="post">
				<input type="hidden" name="action" value="create" />
				<table cellspacing="5" cellpadding="5"><caption>Create New League</caption>
					<tr><td>Name</td><td><input type="text" name="name" /></td></tr>
					<tr><td>Password</td><td><input type="text" name="pass" /></td></tr>
					<tr><td>Humans per Race</td>
						<td>
							<select name="numplayers">
								<%
								for(int i=2; i<=8; i++){
									%>
									<option value="<%=i%>"><%=i%></option>
									<%
								}
								%>
							</select>
						</td></tr>
					<tr><td>Mode</td>
						<td>
							<select name="gamemode">
								<option value="versus">Versus</option>
								<option value="grandprix">Grand Prix</option>
							</select>
						</td></tr>
					<tr><td>Engine</td>
						<td>
							<select name="engine">
								<option value="50cc">50cc</option>
								<option value="100cc">100cc</option>
								<option value="150cc" selected>150cc</option>
								<option value="mirror">Mirror</option>
							</select>
						</td></tr>
					<tr><td>Races per Cluster</td><td>
						<select name="numraces">
						<option value="0">No Limit</option>
						<option value="16">16</option>
						<% for(int n=5;n<=200;n+=5){ %>
						<option value="<%=n %>"><%=n %></option>
						<%} %>
						</select>
					
					</td></tr>
					<tr><td>Laps per Race</td>
						<td>
							<select name="numlaps">
								<option value="0">Reco</option>
								<option value="1">1</option>
								<option value="2">2</option>
								<option value="3">3</option>
								<option value="4">4</option>
								<option value="5">5</option>
								<option value="6">6</option>
								<option value="7">7</option>
								<option value="8">8</option>
								<option value="9">9</option>
							</select>
						</td></tr>
					<tr><td>Items</td>
						<td>
							<select name="items">
								<option value="recommended">Reco</option>
								<option value="none">None</option>
								<option value="basic">Basic</option>
								<option value="frantic">Frantic</option>
							</select>
						</td></tr>
					<tr><td>Courses</td>
						<td>
							<select name="courses" size="16" multiple="multiple">
							<%
							for(String[] cupCourses : League.CUPS){
								for(String course : cupCourses){
									%>
									<option value="<%= course %>"><%= course %></option>
									<%
								}
							}
							%>
							</select>
						</td></tr>
					<tr><td>Specifications</td><td><textarea name="specifications" cols="40" rows="5"></textarea></td></tr>
					<tr><td colspan="2"><input type="submit" value="Create League" /></td></tr>
				</table>
			</form>
		</div>
<%@include file="/templates/footer.html" %>