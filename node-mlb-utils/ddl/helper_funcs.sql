CREATE OR REPLACE FUNCTION ip_fmt(outs INTEGER) 
RETURNS VARCHAR AS $$
  DECLARE 
    ip_fmt VARCHAR(20);
  BEGIN
    ip_fmt := FLOOR(outs/3) || '.' || MOD(outs,3);
    RETURN ip_fmt;
  END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ratio_fmt(num INTEGER, den INTEGER, prec INTEGER, with_raw BOOLEAN) 
RETURNS VARCHAR AS $$
  DECLARE 
    ratio_fmt VARCHAR(50);
  BEGIN
    ratio_fmt := ROUND(num::numeric/den, prec);
    IF with_raw THEN
      ratio_fmt := ratio_fmt || ' (' || num || ' / ' || den ||')';
    END IF;
    
    ratio_fmt := TRIM(LEADING '0' FROM ratio_fmt);
    
    RETURN ratio_fmt;
  END;
$$ LANGUAGE plpgsql;