package baseball;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.jdo.Extent;
import javax.jdo.PersistenceManager;
import javax.jdo.Query;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.htmlparser.Node;
import org.htmlparser.Parser;
import org.htmlparser.filters.HasAttributeFilter;
import org.htmlparser.util.NodeIterator;
import org.htmlparser.util.NodeList;
import org.htmlparser.util.ParserException;

import metabattle.PMF;
import metabattle.SportSeason;

import com.google.appengine.api.datastore.Text;

import daysummary.DaySummary;
import daysummary.DaySummaryWorker;

import rival.Rival;
import util.General;

public class  BaseballTestServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;
	
	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		this.doGet(req, resp);
	}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException{
		Calendar calReportDate = new GregorianCalendar(TimeZone.getTimeZone("America/Los_Angeles"), Locale.US);
		calReportDate.set(
				2011, 
				4-1, 
				7, 
				0, 0, 0);
		
		//System.out.println(games.toString());
	
	}
}
