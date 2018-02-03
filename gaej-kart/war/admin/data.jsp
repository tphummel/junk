<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="java.util.List" %>
<%@ page import="com.google.appengine.api.datastore.KeyFactory" %>
<%@ page import="com.google.appengine.api.users.User" %>
<%@ page import="com.google.appengine.api.users.UserService" %>
<%@ page import="com.google.appengine.api.users.UserServiceFactory" %>
<%@ page import="triad.Cluster" %>
<%@ page import="triad.League" %>
<%@ page import="triad.Match" %>
<%@ page import="triad.Perf" %>
<%@ page import="triad.Player" %>
<%@ page import="triad.Season" %>
<%@ page import="triad.Venue" %>
<%@ page import="triad.PMF" %>

<%@ page import="javax.jdo.PersistenceManager" %>
<%@ page import="javax.jdo.Query" %>
<%@ page import="javax.jdo.Extent" %>

<%@ page import="com.google.gson.Gson" %>

<%
if(!request.getParameterMap().containsKey("entity")){
	%>
	<div>No entity selected. use ?entity=NAME</div>
	<%
	return;
}
%>

<%
Gson gson = new Gson();
PersistenceManager pm = PMF.get().getPersistenceManager();
Query q;
String entity = request.getParameter("entity");
%>
<%= entity + "\n" %>
<%
if(entity == "perf"){
  Extent<Perf> results = pm.getExtent(Perf.class, false);
  for(Perf perf : results){
  	
    String json = gson.toJson(perf);
    %>
    
    <%= perf.toString() %>
    <%= json + "\n" %>
    
    <%
  }
  results.closeAll();
}


%>

