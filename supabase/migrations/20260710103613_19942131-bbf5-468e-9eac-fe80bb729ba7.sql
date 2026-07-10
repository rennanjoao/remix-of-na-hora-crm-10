
-- 1. Extensions for scheduled sending
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. email_flows: slug + optional owner for system flows
ALTER TABLE public.email_flows ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS email_flows_slug_key ON public.email_flows(slug) WHERE slug IS NOT NULL;
ALTER TABLE public.email_flows ALTER COLUMN created_by DROP NOT NULL;

-- 3. email_flow_recipients tracking columns
ALTER TABLE public.email_flow_recipients
  ADD COLUMN IF NOT EXISTS current_step_id uuid REFERENCES public.email_flow_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS update_email_flow_recipients_updated_at ON public.email_flow_recipients;
CREATE TRIGGER update_email_flow_recipients_updated_at BEFORE UPDATE ON public.email_flow_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. suppressed_emails
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  reason text NOT NULL DEFAULT 'unsubscribed',
  suppressed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppressed_emails TO authenticated;
GRANT ALL ON public.suppressed_emails TO service_role;
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage suppression" ON public.suppressed_emails;
CREATE POLICY "Admins manage suppression" ON public.suppressed_emails
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. email_unsubscribe_tokens
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_unsubscribe_tokens_email_idx ON public.email_unsubscribe_tokens(email);
GRANT SELECT ON public.email_unsubscribe_tokens TO authenticated;
GRANT ALL ON public.email_unsubscribe_tokens TO service_role;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Admins view tokens" ON public.email_unsubscribe_tokens
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 6. Migrate email_campaigns -> email_flows via slug/name/created_at match
CREATE TEMP TABLE _flow_map (campaign_id uuid, flow_id uuid) ON COMMIT DROP;
DO $mig$
DECLARE
  r RECORD;
  v_new uuid;
BEGIN
  FOR r IN SELECT * FROM public.email_campaigns LOOP
    INSERT INTO public.email_flows (name, description, type, status, slug, created_by, created_at, updated_at)
    VALUES (r.name, r.description, 'cadence',
            CASE WHEN r.status IN ('ativa','pausada','rascunho','concluida') THEN r.status ELSE 'rascunho' END,
            r.slug, r.created_by, r.created_at, r.updated_at)
    RETURNING id INTO v_new;
    INSERT INTO _flow_map (campaign_id, flow_id) VALUES (r.id, v_new);
  END LOOP;
END $mig$;

-- 7. Migrate email_steps -> email_flow_steps
CREATE TEMP TABLE _step_map (step_id uuid, flow_step_id uuid) ON COMMIT DROP;
DO $mig$
DECLARE
  r RECORD;
  v_new uuid;
  v_flow uuid;
BEGIN
  FOR r IN SELECT * FROM public.email_steps LOOP
    SELECT flow_id INTO v_flow FROM _flow_map WHERE campaign_id = r.campaign_id;
    IF v_flow IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, blocks, body_html, delay_days, created_at, updated_at)
    VALUES (v_flow, r.step_order, NULL, r.subject, '[]'::jsonb, r.body_html, r.delay_days, r.created_at, r.updated_at)
    RETURNING id INTO v_new;
    INSERT INTO _step_map (step_id, flow_step_id) VALUES (r.id, v_new);
  END LOOP;
END $mig$;

-- 8. Migrate email_blast_lists -> flows(type=blast) + step + recipients
DO $mig$
DECLARE
  r RECORD;
  v_flow uuid;
  v_step uuid;
BEGIN
  FOR r IN SELECT * FROM public.email_blast_lists LOOP
    INSERT INTO public.email_flows (name, type, status, created_by, created_at, updated_at)
    VALUES (r.name, 'blast',
      CASE WHEN r.status IN ('enviado','concluida') THEN 'concluida' ELSE 'rascunho' END,
      r.created_by, r.created_at, r.updated_at)
    RETURNING id INTO v_flow;

    INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, blocks, body_html, delay_days)
    VALUES (v_flow, 1, 'Disparo', r.subject, '[]'::jsonb, r.body_html, 0)
    RETURNING id INTO v_step;

    IF array_length(r.lead_ids, 1) > 0 THEN
      INSERT INTO public.email_flow_recipients (flow_id, lead_id, status)
      SELECT v_flow, x, 'pending' FROM unnest(r.lead_ids) x
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $mig$;

-- 9. email_sends: add flow columns + payload/attempt columns, migrate, drop old FKs+cols
ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS flow_id uuid,
  ADD COLUMN IF NOT EXISTS flow_step_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_id uuid,
  ADD COLUMN IF NOT EXISTS to_email text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid;

UPDATE public.email_sends es SET flow_step_id = m.flow_step_id
  FROM _step_map m WHERE es.step_id = m.step_id AND es.flow_step_id IS NULL;
UPDATE public.email_sends es SET flow_id = fs.flow_id
  FROM public.email_flow_steps fs WHERE es.flow_step_id = fs.id AND es.flow_id IS NULL;

ALTER TABLE public.email_sends DROP CONSTRAINT IF EXISTS email_sends_campaign_id_fkey;
ALTER TABLE public.email_sends DROP CONSTRAINT IF EXISTS email_sends_step_id_fkey;
ALTER TABLE public.email_sends DROP COLUMN IF EXISTS campaign_id;
ALTER TABLE public.email_sends DROP COLUMN IF EXISTS step_id;

ALTER TABLE public.email_sends
  ADD CONSTRAINT email_sends_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.email_flows(id) ON DELETE SET NULL,
  ADD CONSTRAINT email_sends_flow_step_id_fkey FOREIGN KEY (flow_step_id) REFERENCES public.email_flow_steps(id) ON DELETE SET NULL,
  ADD CONSTRAINT email_sends_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.email_flow_recipients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_pending ON public.email_sends (status, scheduled_for)
  WHERE status = 'pending';

-- 10. Drop legacy tables
DROP TABLE IF EXISTS public.email_blast_lists CASCADE;
DROP TABLE IF EXISTS public.email_steps CASCADE;
DROP TABLE IF EXISTS public.email_campaigns CASCADE;

-- 11. Seed 3 system flows (idempotent via slug)
DO $seed$
DECLARE
  v_admin uuid;
  v_flow uuid;
BEGIN
  SELECT p.id INTO v_admin FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'admin' ORDER BY p.created_at LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.email_flows WHERE slug = 'apresentacao-institucional') THEN
    INSERT INTO public.email_flows (name, slug, description, type, status, created_by)
    VALUES ('Apresentação institucional', 'apresentacao-institucional',
            'Enviado após lead pedir apresentação', 'cadence', 'ativa', v_admin)
    RETURNING id INTO v_flow;
    INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, blocks, body_html, delay_days)
    VALUES (v_flow, 1, 'Apresentação', 'Apresentação institucional Na Hora Transporte',
      '[{"id":"b1","type":"text","html":"<p>Olá {{lead.nome}}, conforme conversamos, segue nossa apresentação institucional. Qualquer dúvida, me chame por aqui mesmo.</p>"}]'::jsonb,
      '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;"><div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;margin:12px 0;"><p>Olá {{lead.nome}}, conforme conversamos, segue nossa apresentação institucional. Qualquer dúvida, me chame por aqui mesmo.</p></div></div>',
      0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.email_flows WHERE slug = 'recaptura-pos-silencio') THEN
    INSERT INTO public.email_flows (name, slug, description, type, status, created_by)
    VALUES ('Recaptura pós-silêncio', 'recaptura-pos-silencio',
            'Reengajamento após lead ficar sem resposta', 'cadence', 'ativa', v_admin)
    RETURNING id INTO v_flow;
    INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, blocks, body_html, delay_days)
    VALUES (v_flow, 1, 'Recaptura', 'Ainda pensando na Na Hora, {{lead.nome}}?',
      '[{"id":"b1","type":"text","html":"<p>Oi {{lead.nome}}, sei que a rotina em {{lead.cidade}} é corrida. Consegue me dar 5 minutos essa semana?</p>"}]'::jsonb,
      '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;"><div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;margin:12px 0;"><p>Oi {{lead.nome}}, sei que a rotina em {{lead.cidade}} é corrida. Consegue me dar 5 minutos essa semana?</p></div></div>',
      3);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.email_flows WHERE slug = 'objeccao-frota-propria') THEN
    INSERT INTO public.email_flows (name, slug, description, type, status, created_by)
    VALUES ('Objeção: frota própria', 'objeccao-frota-propria',
            'Retorno em ~45 dias para lead com frota própria', 'cadence', 'ativa', v_admin)
    RETURNING id INTO v_flow;
    INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, blocks, body_html, delay_days)
    VALUES (v_flow, 1, 'Retorno frota', 'Quando o pico bate, a frota própria dá conta?',
      '[{"id":"b1","type":"text","html":"<p>Olá {{lead.nome}}, muitas empresas como a {{lead.empresa}} usam a Na Hora como retaguarda em picos de demanda. Vamos conversar sobre como estruturar isso aí?</p>"}]'::jsonb,
      '<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;"><div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;margin:12px 0;"><p>Olá {{lead.nome}}, muitas empresas como a {{lead.empresa}} usam a Na Hora como retaguarda em picos de demanda. Vamos conversar sobre como estruturar isso aí?</p></div></div>',
      45);
  END IF;
END $seed$;
