-- ============ 1. Índices faltantes ============
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_start ON public.tasks (assigned_to, start_time) WHERE completed IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON public.tasks (lead_id);
CREATE INDEX IF NOT EXISTS idx_meetings_lead ON public.meetings (lead_id);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON public.meetings (meeting_date);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_status ON public.leads (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_status_created ON public.leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_inbox_received ON public.email_inbox (received_at DESC);

-- Idempotência de envio: um passo de fluxo só é enviado uma vez por lead
CREATE UNIQUE INDEX IF NOT EXISTS email_sends_flow_step_unique_idx
  ON public.email_sends (lead_id, flow_id, flow_step_id)
  WHERE flow_step_id IS NOT NULL;

-- ============ 2. Helpers de normalização ============
CREATE OR REPLACE FUNCTION public.only_digits(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(COALESCE(_t,''), '\D', '', 'g') $$;

CREATE OR REPLACE FUNCTION public.unaccent_fallback(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(COALESCE(_t,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

CREATE OR REPLACE FUNCTION public.norm_text(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(regexp_replace(public.unaccent_fallback(COALESCE(_t,'')), '\s+', ' ', 'g')))
$$;

-- ============ 3. Fila de jobs ============
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  locked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gestores veem jobs" ON public.jobs;
CREATE POLICY "Gestores veem jobs" ON public.jobs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gerente'));

DROP TRIGGER IF EXISTS jobs_updated_at ON public.jobs;
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_active_idx
  ON public.jobs (job_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing','retrying');

CREATE INDEX IF NOT EXISTS jobs_claim_idx
  ON public.jobs (status, priority DESC, scheduled_at)
  WHERE status IN ('pending','retrying');

-- ============ 4. Saúde e cota de provedores ============
CREATE TABLE IF NOT EXISTS public.provider_health (
  provider text PRIMARY KEY,
  is_paused boolean NOT NULL DEFAULT false,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  paused_until timestamptz,
  daily_limit integer,
  used_today integer NOT NULL DEFAULT 0,
  usage_reset_date date NOT NULL DEFAULT CURRENT_DATE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_health TO authenticated;
GRANT ALL ON public.provider_health TO service_role;
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Gestores veem saude de provedores" ON public.provider_health;
CREATE POLICY "Gestores veem saude de provedores" ON public.provider_health FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gerente'));

INSERT INTO public.provider_health (provider, daily_limit) VALUES
  ('cnpj', 5000), ('places', 2000), ('email', 3000), ('geocoding', 2000), ('whatsapp', NULL)
ON CONFLICT (provider) DO NOTHING;

-- ============ 5. Feature flags ============
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  mock_mode boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_flags TO authenticated;
GRANT INSERT, UPDATE ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Todos leem flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admin altera flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admin cria flags" ON public.feature_flags;
CREATE POLICY "Todos leem flags" ON public.feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin altera flags" ON public.feature_flags FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admin cria flags" ON public.feature_flags FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.feature_flags (key, description) VALUES
  ('ENRICHMENT_CNPJ', 'Enriquecimento de CNPJ (BrasilAPI/ReceitaWS)'),
  ('ENRICHMENT_PLACES', 'Enriquecimento Google Places'),
  ('EMAIL_SENDING', 'Envio de e-mails'),
  ('AUTOMATION', 'Motor de cadência e fluxos'),
  ('WHATSAPP', 'Integração WhatsApp via provider')
ON CONFLICT (key) DO NOTHING;

-- ============ 6. Worker: claim de jobs (service role) ============
CREATE OR REPLACE FUNCTION public.claim_jobs(_limit integer DEFAULT 10, _types text[] DEFAULT NULL)
RETURNS SETOF public.jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- destrava jobs presos há mais de 10 minutos
  UPDATE public.jobs SET status='retrying', locked_at=NULL
  WHERE status='processing' AND locked_at < now() - interval '10 minutes';

  RETURN QUERY
  WITH pick AS (
    SELECT id FROM public.jobs
    WHERE status IN ('pending','retrying')
      AND scheduled_at <= now()
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND (_types IS NULL OR job_type = ANY(_types))
    ORDER BY priority DESC, scheduled_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(_limit, 1)
  )
  UPDATE public.jobs j
  SET status='processing', started_at=COALESCE(j.started_at, now()),
      locked_at=now(), attempts=j.attempts+1
  FROM pick WHERE j.id = pick.id
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_jobs(integer, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_job(_id uuid, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id=_id;
  IF v_job.id IS NULL THEN RETURN; END IF;

  IF _error IS NULL THEN
    UPDATE public.jobs SET status='completed', finished_at=now(), locked_at=NULL, last_error=NULL WHERE id=_id;
  ELSIF v_job.attempts >= v_job.max_attempts THEN
    UPDATE public.jobs SET status='failed', finished_at=now(), locked_at=NULL, last_error=_error WHERE id=_id;
  ELSE
    UPDATE public.jobs SET status='retrying', locked_at=NULL, last_error=_error,
      next_retry_at = now() + (CASE v_job.attempts WHEN 1 THEN interval '30 seconds'
                                                   WHEN 2 THEN interval '2 minutes'
                                                   ELSE interval '10 minutes' END)
    WHERE id=_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_job(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, text) TO service_role;

-- ============ 7. Kanban: contagem e paginação por coluna ============
CREATE OR REPLACE FUNCTION public.leads_status_counts(_search text DEFAULT NULL, _only_mine boolean DEFAULT false)
RETURNS TABLE(status text, total bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT l.status::text, count(*)
  FROM public.leads l
  WHERE (_search IS NULL OR _search = '' OR
         public.norm_text(l.razao_social) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.nome_fantasia) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.cidade) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.nome_decisor) LIKE '%'||public.norm_text(_search)||'%' OR
         (public.only_digits(_search) <> '' AND public.only_digits(l.cnpj) LIKE '%'||public.only_digits(_search)||'%') OR
         (public.only_digits(_search) <> '' AND public.only_digits(l.telefone) LIKE '%'||public.only_digits(_search)||'%'))
    AND (_only_mine = false OR l.assigned_to = public.get_profile_id(auth.uid()))
  GROUP BY l.status;
$$;

CREATE OR REPLACE FUNCTION public.leads_by_status(
  _status text,
  _search text DEFAULT NULL,
  _only_mine boolean DEFAULT false,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS SETOF public.leads
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT l.* FROM public.leads l
  WHERE l.status::text = _status
    AND (_search IS NULL OR _search = '' OR
         public.norm_text(l.razao_social) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.nome_fantasia) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.cidade) LIKE '%'||public.norm_text(_search)||'%' OR
         public.norm_text(l.nome_decisor) LIKE '%'||public.norm_text(_search)||'%' OR
         (public.only_digits(_search) <> '' AND public.only_digits(l.cnpj) LIKE '%'||public.only_digits(_search)||'%') OR
         (public.only_digits(_search) <> '' AND public.only_digits(l.telefone) LIKE '%'||public.only_digits(_search)||'%'))
    AND (_only_mine = false OR l.assigned_to = public.get_profile_id(auth.uid()))
  ORDER BY l.updated_at DESC
  LIMIT GREATEST(LEAST(_limit, 200), 1) OFFSET GREATEST(_offset, 0);
$$;