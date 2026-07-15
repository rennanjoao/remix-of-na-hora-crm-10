
CREATE OR REPLACE FUNCTION public.sdr_work_queue()
RETURNS TABLE (
  item_key text,
  source text,
  bucket text,
  priority int,
  lead_id uuid,
  lead_name text,
  lead_city text,
  lead_state text,
  lead_phone text,
  lead_email text,
  lead_status text,
  title text,
  due_at timestamptz,
  extra jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_role app_role;
BEGIN
  v_profile := public.get_profile_id(auth.uid());
  v_role := public.get_user_role(auth.uid());
  IF v_profile IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- 1) Respostas de e-mail (últimos 14 dias) para leads meus
  SELECT
    ('resp:' || ei.id)::text, 'response'::text, 'responses'::text, 100,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    ('Respondeu: ' || COALESCE(ei.subject, '(sem assunto)'))::text,
    ei.received_at,
    jsonb_build_object('inbox_id', ei.id, 'from', ei.from_email)
  FROM email_inbox ei
  JOIN leads l ON l.id = ei.lead_id
  WHERE ei.lead_id IS NOT NULL
    AND ei.received_at > now() - interval '14 days'
    AND (v_role IN ('admin','gerente') OR l.assigned_to = v_profile OR l.created_by = v_profile)

  UNION ALL
  -- 2) Reuniões nas próximas 2h
  SELECT
    ('meet:' || m.id)::text, 'meeting'::text, 'now'::text, 95,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    ('Reunião em breve: ' || m.title)::text,
    m.meeting_date,
    jsonb_build_object('meeting_id', m.id, 'link', COALESCE(m.jitsi_link, m.meeting_link))
  FROM meetings m
  JOIN leads l ON l.id = m.lead_id
  WHERE m.status IN ('agendada','confirmada','scheduled','confirmed')
    AND m.meeting_date BETWEEN now() AND now() + interval '2 hours'
    AND (v_role IN ('admin','gerente') OR m.sdr_id = v_profile OR m.created_by = v_profile)

  UNION ALL
  -- 3) Tarefas atrasadas
  SELECT
    ('task:' || t.id)::text, 'task_overdue'::text, 'overdue'::text, 80,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    t.title,
    t.start_time,
    jsonb_build_object('task_id', t.id)
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE COALESCE(t.completed, false) = false
    AND t.start_time < now()
    AND t.assigned_to = v_profile

  UNION ALL
  -- 4) Follow-ups de hoje
  SELECT
    ('task:' || t.id)::text, 'task_today'::text, 'today'::text, 60,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    t.title,
    t.start_time,
    jsonb_build_object('task_id', t.id)
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE COALESCE(t.completed, false) = false
    AND t.start_time >= now()
    AND t.start_time < date_trunc('day', now()) + interval '1 day'
    AND t.assigned_to = v_profile

  UNION ALL
  -- 5) Novos leads sem contato registrado
  SELECT
    ('new:' || l.id)::text, 'new_lead'::text, 'new'::text, 40,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    ('Novo lead: ' || COALESCE(l.nome_fantasia, l.razao_social))::text,
    l.created_at,
    '{}'::jsonb
  FROM leads l
  WHERE l.status = 'novo'
    AND COALESCE(l.is_suppressed, false) = false
    AND l.assigned_to = v_profile
    AND NOT EXISTS (
      SELECT 1 FROM lead_activities la
      WHERE la.lead_id = l.id
        AND la.action_type IN ('call_made','email_sent','whatsapp_sent')
    )

  UNION ALL
  -- 6) Reativação
  SELECT
    ('react:' || l.id)::text, 'reactivation'::text, 'reactivation'::text, 20,
    l.id, COALESCE(l.nome_fantasia, l.razao_social), l.cidade, l.estado,
    l.telefone, l.email, l.status::text,
    ('Reativar contato')::text,
    l.next_contact_date::timestamptz,
    '{}'::jsonb
  FROM leads l
  WHERE COALESCE(l.is_suppressed, false) = true
    AND l.next_contact_date IS NOT NULL
    AND l.next_contact_date <= now()::date
    AND l.assigned_to = v_profile

  ORDER BY priority DESC NULLS LAST, due_at ASC NULLS LAST
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sdr_work_queue() TO authenticated;
