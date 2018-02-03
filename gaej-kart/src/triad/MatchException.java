package triad;

public class MatchException extends Exception {
	private static final long serialVersionUID = 1L;
	public MatchException(){
		super();
	}
	public MatchException(String err){
		super(err);
	}
}
