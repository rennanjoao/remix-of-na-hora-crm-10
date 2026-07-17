
-- Fase 1: Proteção operacional
-- 1) Índice em leads(website)
CREATE INDEX IF NOT EXISTS idx_leads_website ON public.leads(website) WHERE website IS NOT NULL;

-- 2) Rate limit diário por domínio remetente
ALTER TABLE public.email_domains
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS daily_send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_count_reset_date date NOT NULL DEFAULT CURRENT_DATE;

-- Função atômica: tenta consumir 1 envio do domínio; retorna true se ok, false se estourou
CREATE OR REPLACE FUNCTION public.try_consume_email_quota(_domain_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.email_domains
  SET
    daily_send_count = CASE
      WHEN daily_count_reset_date < CURRENT_DATE THEN 1
      ELSE daily_send_count + 1
    END,
    daily_count_reset_date = CURRENT_DATE
  WHERE id = _domain_id
    AND (daily_count_reset_date < CURRENT_DATE OR daily_send_count < daily_limit)
  RETURNING true INTO v_ok;

  RETURN COALESCE(v_ok, false);
END;
$$;

-- 3) Buscas salvas (Fase 3, mas já com RLS pronta)
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdr_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text NOT NULL,
  zone text,
  email_filter text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SDR gerencia suas próprias buscas"
ON public.saved_searches FOR ALL
TO authenticated
USING (sdr_id = public.get_profile_id(auth.uid()))
WITH CHECK (sdr_id = public.get_profile_id(auth.uid()));

CREATE POLICY "Admin/gerente veem todas as buscas"
ON public.saved_searches FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gerente'));

CREATE TRIGGER set_saved_searches_updated_at
BEFORE UPDATE ON public.saved_searches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) View de duplicatas candidatas (Fase 5)
CREATE OR REPLACE VIEW public.duplicate_lead_candidates AS
SELECT
  LEAST(a.id, b.id) AS lead_a_id,
  GREATEST(a.id, b.id) AS lead_b_id,
  CASE
    WHEN a.cnpj IS NOT NULL AND a.cnpj = b.cnpj THEN 'cnpj'
    WHEN a.telefone IS NOT NULL AND a.telefone = b.telefone THEN 'telefone'
    WHEN a.email IS NOT NULL AND a.email = b.email THEN 'email'
  END AS match_type,
  COALESCE(a.nome_fantasia, a.razao_social) AS lead_a_name,
  COALESCE(b.nome_fantasia, b.razao_social) AS lead_b_name
FROM public.leads a
JOIN public.leads b
  ON a.id < b.id
 AND (
      (a.cnpj IS NOT NULL AND a.cnpj = b.cnpj)
   OR (a.telefone IS NOT NULL AND a.telefone = b.telefone)
   OR (a.email IS NOT NULL AND a.email = b.email)
 );

GRANT SELECT ON public.duplicate_lead_candidates TO authenticated;

-- 5) Merge de leads (mantém o mais antigo, migra referências, suprime o perdedor)
CREATE OR REPLACE FUNCTION public.merge_leads(_winner uuid, _loser uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas admin pode mesclar leads';
  END IF;
  IF _winner = _loser THEN
    RAISE EXCEPTION 'Winner e loser não podem ser iguais';
  END IF;

  UPDATE public.lead_timeline    SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.lead_activities  SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.meetings         SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.tasks            SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.email_sends      SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.email_inbox      SET lead_id = _winner WHERE lead_id = _loser;
  UPDATE public.cnpj_consultas   SET lead_id = _winner WHERE lead_id = _loser;

  UPDATE public.leads
  SET is_suppressed = true,
      suppression_reason = COALESCE(suppression_reason,'') || ' [mesclado com ' || _winner::text || ']'
  WHERE id = _loser;
END;
$$;
