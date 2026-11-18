-- 0149 rollback: restore the 0032 placeholder.
--
-- Churn scoring reverts to the constant 0.1 for every contact. The response's
-- provenance keys (added by #3203) keep saying which source they read, so
-- rolling this function back does not silently relabel the number as modelled.

CREATE OR REPLACE FUNCTION public.calculate_churn_risk(p_contact_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
 BEGIN
   RETURN 0.1;
 END;
$function$;
