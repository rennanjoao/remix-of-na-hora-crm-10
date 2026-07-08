CREATE OR REPLACE FUNCTION public.get_sdr_performance(_days integer DEFAULT 7)
 RETURNS TABLE(sdr_id uuid, full_name text, dia timestamp with time zone, consultas_realizadas bigint, leads_importados bigint, reunioes_agendadas bigint, emails_enviados bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  RETURN QUERY
  SELECT v.sdr_id, v.full_name, v.dia,
         v.consultas_realizadas, v.leads_importados,
         v.reunioes_agendadas, v.emails_enviados
  FROM public.sdr_performance_daily v
  WHERE v.dia >= date_trunc('day', now() - (_days || ' days')::interval);
END;
$function$;

CREATE OR REPLACE FUNCTION public.leads_para_reativar()
 RETURNS SETOF public.leads
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.leads
  WHERE is_suppressed = true
    AND next_contact_date IS NOT NULL
    AND next_contact_date <= now()::date
  ORDER BY next_contact_date ASC;
$function$;

CREATE OR REPLACE FUNCTION public.claim_next_lead()
 RETURNS public.leads
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_lead public.leads;
BEGIN
  v_profile_id := public.get_profile_id(auth.uid());
  UPDATE public.leads SET locked_by = NULL, locked_at = NULL
  WHERE locked_at < now() - interval '10 minutes';
  SELECT * INTO v_lead FROM public.leads
  WHERE status = 'novo' AND locked_by IS NULL
  ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_lead.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.leads
  SET locked_by = v_profile_id, locked_at = now(), assigned_to = v_profile_id
  WHERE id = v_lead.id RETURNING * INTO v_lead;
  RETURN v_lead;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sdr_performance(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leads_para_reativar()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_lead()            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sdr_performance(integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.leads_para_reativar()        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_next_lead()            TO authenticated;