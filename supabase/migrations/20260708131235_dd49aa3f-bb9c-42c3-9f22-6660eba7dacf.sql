
DROP POLICY IF EXISTS "SDRs and gerentes can view all leads" ON public.leads;

CREATE POLICY "SDRs can view only their own leads"
ON public.leads FOR SELECT
USING (
  has_role(auth.uid(), 'sdr'::app_role) AND (
    assigned_to = get_profile_id(auth.uid()) OR
    created_by  = get_profile_id(auth.uid())
  )
);

CREATE POLICY "Gerentes can view all leads"
ON public.leads FOR SELECT
USING (has_role(auth.uid(), 'gerente'::app_role));

CREATE INDEX IF NOT EXISTS idx_cnpj_consultas_sdr_created ON public.cnpj_consultas(consultado_por, created_at);
CREATE INDEX IF NOT EXISTS idx_meetings_sdr_created      ON public.meetings(sdr_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_sdr_created   ON public.email_sends(sdr_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at          ON public.leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at          ON public.leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_lead_timeline_created_at  ON public.lead_timeline(created_at);
CREATE INDEX IF NOT EXISTS idx_lead_timeline_lead_id     ON public.lead_timeline(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_telefone            ON public.leads(telefone);
CREATE INDEX IF NOT EXISTS idx_leads_cnpj                ON public.leads(cnpj);
CREATE INDEX IF NOT EXISTS idx_leads_status              ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_contact_date   ON public.leads(next_contact_date);
CREATE INDEX IF NOT EXISTS idx_leads_is_suppressed       ON public.leads(is_suppressed);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to         ON public.leads(assigned_to);

CREATE OR REPLACE VIEW public.sdr_performance_daily AS
SELECT
  p.id AS sdr_id,
  p.full_name,
  d.dia,
  COALESCE(consultas.total, 0)  AS consultas_realizadas,
  COALESCE(consultas.importados, 0) AS leads_importados,
  COALESCE(reunioes.total, 0)   AS reunioes_agendadas,
  COALESCE(emails.total, 0)     AS emails_enviados
FROM public.profiles p
CROSS JOIN LATERAL (
  SELECT generate_series(
    date_trunc('day', now() - interval '30 days'),
    date_trunc('day', now()),
    interval '1 day'
  ) AS dia
) d
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE importado) AS importados
  FROM public.cnpj_consultas cc
  WHERE cc.consultado_por = p.id AND date_trunc('day', cc.created_at) = d.dia
) consultas ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total FROM public.meetings m
  WHERE m.sdr_id = p.id AND date_trunc('day', m.created_at) = d.dia
) reunioes ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total FROM public.email_sends es
  WHERE es.sdr_id = p.id AND date_trunc('day', es.created_at) = d.dia
) emails ON true;

CREATE OR REPLACE FUNCTION public.get_sdr_performance(_days int DEFAULT 7)
RETURNS TABLE (
  sdr_id uuid, full_name text, dia timestamptz,
  consultas_realizadas bigint, leads_importados bigint,
  reunioes_agendadas bigint, emails_enviados bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  RETURN QUERY
  SELECT v.sdr_id, v.full_name, v.dia,
         v.consultas_realizadas, v.leads_importados,
         v.reunioes_agendadas, v.emails_enviados
  FROM public.sdr_performance_daily v
  WHERE v.dia >= date_trunc('day', now() - (_days || ' days')::interval);
END;
$$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_next_lead()
RETURNS public.leads
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_timeline; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.email_sends; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.leads         REPLICA IDENTITY FULL;
ALTER TABLE public.lead_timeline REPLICA IDENTITY FULL;
ALTER TABLE public.email_sends   REPLICA IDENTITY FULL;
ALTER TABLE public.meetings      REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.approach_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approach_scripts TO authenticated;
GRANT ALL ON public.approach_scripts TO service_role;

ALTER TABLE public.approach_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos autenticados podem ver scripts"
ON public.approach_scripts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins gerenciam scripts"
ON public.approach_scripts FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS approach_scripts_updated_at ON public.approach_scripts;
CREATE TRIGGER approach_scripts_updated_at
BEFORE UPDATE ON public.approach_scripts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.approach_scripts (name, channel, body, is_default) VALUES
('WhatsApp - Abertura por segmento', 'whatsapp',
 'Olá! Vi que vocês atuam no segmento {segmento} em {cidade}. Sou da Na Hora Transporte e trabalhamos com frete dedicado para empresas como a de vocês. Faz sentido conversarmos sobre logística?',
 true),
('WhatsApp - Genérico', 'whatsapp',
 'Olá {nome}, tudo bem? Sou da Na Hora Transporte, especialistas em frete dedicado. Podemos conversar sobre a logística de vocês?',
 false);
