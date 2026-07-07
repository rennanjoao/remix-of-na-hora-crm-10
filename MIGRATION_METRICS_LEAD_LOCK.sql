-- Pending migration: performance indexes, SDR metrics view/RPC, lead lock + claim_next_lead
-- Apply via the Lovable Cloud migration tool.

-- 1. Índices de performance
CREATE INDEX IF NOT EXISTS idx_cnpj_consultas_sdr_created ON public.cnpj_consultas(consultado_por, created_at);
CREATE INDEX IF NOT EXISTS idx_meetings_sdr_created ON public.meetings(sdr_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_sends_sdr_created ON public.email_sends(sdr_id, created_at);

-- 2. View e RPC de Métricas (Liderança)
CREATE OR REPLACE VIEW public.sdr_performance_daily AS
SELECT
  p.id AS sdr_id,
  p.full_name,
  date_trunc('day', cc.created_at) AS dia,
  COUNT(DISTINCT cc.id) AS consultas_realizadas,
  COUNT(DISTINCT cc.id) FILTER (WHERE cc.importado) AS leads_importados,
  COUNT(DISTINCT m.id) AS reunioes_agendadas,
  COUNT(DISTINCT es.id) AS emails_enviados
FROM public.profiles p
LEFT JOIN public.cnpj_consultas cc ON cc.consultado_por = p.id AND cc.created_at >= now() - interval '30 days'
LEFT JOIN public.meetings m ON m.sdr_id = p.id AND m.created_at >= now() - interval '30 days'
LEFT JOIN public.email_sends es ON es.sdr_id = p.id AND es.created_at >= now() - interval '30 days'
GROUP BY p.id, p.full_name, date_trunc('day', cc.created_at);

CREATE OR REPLACE FUNCTION public.get_sdr_performance(_days int DEFAULT 7)
RETURNS TABLE (
  sdr_id uuid,
  full_name text,
  dia timestamptz,
  consultas_realizadas bigint,
  leads_importados bigint,
  reunioes_agendadas bigint,
  emails_enviados bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente')) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  RETURN QUERY SELECT * FROM public.sdr_performance_daily WHERE dia >= now() - (_days || ' days')::interval;
END;
$$;

-- 3. Lock de Concorrência (Fila SDR)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_next_lead()
RETURNS public.leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_lead public.leads;
BEGIN
  v_profile_id := public.get_profile_id(auth.uid());

  UPDATE public.leads
  SET locked_by = NULL, locked_at = NULL
  WHERE locked_at < now() - interval '10 minutes';

  SELECT * INTO v_lead
  FROM public.leads
  WHERE status = 'novo' AND locked_by IS NULL
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_lead.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
  SET locked_by = v_profile_id, locked_at = now(), assigned_to = v_profile_id
  WHERE id = v_lead.id
  RETURNING * INTO v_lead;

  RETURN v_lead;
END;
$$;
