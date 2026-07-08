DROP VIEW IF EXISTS public.sdr_performance_daily;
CREATE VIEW public.sdr_performance_daily
WITH (security_invoker = true) AS
SELECT p.id AS sdr_id, p.full_name, d.dia,
    COALESCE(consultas.total, 0::bigint) AS consultas_realizadas,
    COALESCE(consultas.importados, 0::bigint) AS leads_importados,
    COALESCE(reunioes.total, 0::bigint) AS reunioes_agendadas,
    COALESCE(emails.total, 0::bigint) AS emails_enviados
FROM public.profiles p
CROSS JOIN LATERAL (
  SELECT generate_series(date_trunc('day', now() - interval '30 days'),
                         date_trunc('day', now()),
                         interval '1 day') AS dia
) d
LEFT JOIN LATERAL (
  SELECT count(*) AS total, count(*) FILTER (WHERE cc.importado) AS importados
  FROM public.cnpj_consultas cc
  WHERE cc.consultado_por = p.id AND date_trunc('day', cc.created_at) = d.dia
) consultas ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS total FROM public.meetings m
  WHERE m.sdr_id = p.id AND date_trunc('day', m.created_at) = d.dia
) reunioes ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS total FROM public.email_sends es
  WHERE es.sdr_id = p.id AND date_trunc('day', es.created_at) = d.dia
) emails ON true;
GRANT SELECT ON public.sdr_performance_daily TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_id(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sdr_performance(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_lead()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leads_para_reativar()        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sdr_performance(integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_next_lead()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.leads_para_reativar()        TO authenticated;

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can do everything with profiles" ON public.profiles;
CREATE POLICY "profiles_select_self_or_privileged" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'gerente'::app_role));
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage all consultas" ON public.cnpj_consultas;
DROP POLICY IF EXISTS "Gerentes can view all consultas" ON public.cnpj_consultas;
DROP POLICY IF EXISTS "SDRs can manage own consultas" ON public.cnpj_consultas;
CREATE POLICY "consultas_admin_all" ON public.cnpj_consultas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "consultas_gerente_select" ON public.cnpj_consultas FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'gerente'::app_role));
CREATE POLICY "consultas_sdr_all" ON public.cnpj_consultas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'sdr'::app_role) AND consultado_por = public.get_profile_id(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role) AND consultado_por = public.get_profile_id(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view timeline" ON public.lead_timeline;
DROP POLICY IF EXISTS "SDRs and admins can add timeline" ON public.lead_timeline;
CREATE POLICY "timeline_select" ON public.lead_timeline FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'gerente'::app_role)
    OR EXISTS (SELECT 1 FROM public.leads l
       WHERE l.id = lead_timeline.lead_id
         AND (l.assigned_to = public.get_profile_id(auth.uid())
              OR l.created_by = public.get_profile_id(auth.uid())))
  );
CREATE POLICY "timeline_insert" ON public.lead_timeline FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'sdr'::app_role));

DROP POLICY IF EXISTS "Admins can manage all leads" ON public.leads;
DROP POLICY IF EXISTS "Gerentes can view all leads" ON public.leads;
DROP POLICY IF EXISTS "SDRs can insert leads" ON public.leads;
DROP POLICY IF EXISTS "SDRs can manage their leads" ON public.leads;
DROP POLICY IF EXISTS "SDRs can view only their own leads" ON public.leads;
CREATE POLICY "leads_admin_all" ON public.leads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "leads_gerente_select" ON public.leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'gerente'::app_role));
CREATE POLICY "leads_sdr_insert" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role));
CREATE POLICY "leads_sdr_all" ON public.leads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'sdr'::app_role)
    AND (created_by = public.get_profile_id(auth.uid()) OR assigned_to = public.get_profile_id(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role)
    AND (created_by = public.get_profile_id(auth.uid()) OR assigned_to = public.get_profile_id(auth.uid())));

DROP POLICY IF EXISTS "Admins can manage all meetings" ON public.meetings;
DROP POLICY IF EXISTS "Gerentes can view all meetings" ON public.meetings;
DROP POLICY IF EXISTS "SDRs can insert meetings" ON public.meetings;
DROP POLICY IF EXISTS "SDRs can manage own meetings" ON public.meetings;
CREATE POLICY "meetings_admin_all" ON public.meetings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "meetings_gerente_select" ON public.meetings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'gerente'::app_role));
CREATE POLICY "meetings_sdr_insert" ON public.meetings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role));
CREATE POLICY "meetings_sdr_all" ON public.meetings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'sdr'::app_role)
    AND (sdr_id = public.get_profile_id(auth.uid()) OR created_by = public.get_profile_id(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role)
    AND (sdr_id = public.get_profile_id(auth.uid()) OR created_by = public.get_profile_id(auth.uid())));

DROP POLICY IF EXISTS "Admins can manage all tasks" ON public.tasks;
DROP POLICY IF EXISTS "Gerentes can view all tasks" ON public.tasks;
DROP POLICY IF EXISTS "SDRs can manage own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can view own tasks" ON public.tasks;
CREATE POLICY "tasks_admin_all" ON public.tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "tasks_gerente_select" ON public.tasks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'gerente'::app_role));
CREATE POLICY "tasks_sdr_all" ON public.tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'sdr'::app_role)
    AND (assigned_to = public.get_profile_id(auth.uid()) OR created_by = public.get_profile_id(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role)
    AND (assigned_to = public.get_profile_id(auth.uid()) OR created_by = public.get_profile_id(auth.uid())));
CREATE POLICY "tasks_users_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tasks_users_select_assigned" ON public.tasks FOR SELECT TO authenticated
  USING (assigned_to = public.get_profile_id(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "user_roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);