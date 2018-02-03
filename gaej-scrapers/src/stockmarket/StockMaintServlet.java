package stockmarket;

import java.io.IOException;
import java.util.Iterator;

import javax.jdo.Extent;
import javax.jdo.PersistenceManager;
import javax.jdo.Query;
import javax.jdo.Transaction;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import metabattle.PMF;


public class StockMaintServlet extends HttpServlet {
	private static final long serialVersionUID = 1L;
	
	public void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException { this.doGet(req, resp);}
	
	public void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
		// load extent to walk through ALL match entities
		
		int totCount = 0;
		int chgCount = 0;
		PersistenceManager pm = PMF.get().getPersistenceManager();
		Transaction tx = pm.currentTransaction();
		Extent<StockPrice> extent = pm.getExtent(StockPrice.class, false);
	    Iterator<StockPrice> iter = extent.iterator();
	    extent.closeAll();
		try{
		    while (iter.hasNext()) {
		    	
		    	StockPrice m = iter.next();
		        if(m.getPriceMA() == null || m.getPriceMA() == 0){
		        	m.setPriceS(null);
		        	m.setPriceZ(null);
		        	
		        	m.setVolumeMA(null);
		        	m.setVolumeS(null);
		        	m.setVolumeZ(null);
		        	
		        	m.setRangeMA(null);
		        	m.setRangeS(null);
		        	m.setRangeZ(null);
		        	
		        	tx.begin();
		        	pm.makePersistent(m);
		        	tx.commit();
		        	
		        	chgCount++;
		        }
		        totCount++;
		    }
		}finally{
			if (tx.isActive()){
				tx.rollback();
		    }
		    pm.close();
		}
	    resp.setContentType("text/plain");
        resp.getWriter().println("Maintenance Completedd");
        resp.getWriter().println("Entities Checked: "+ totCount);
        resp.getWriter().println("Entities Updated: "+ chgCount);
	
	}
	
	

}
