
-- email_flows
CREATE TABLE public.email_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'cadence' CHECK (type IN ('cadence','blast')),
  status TEXT NOT NULL DEFAULT 'rascunho',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_flows TO authenticated;
GRANT ALL ON public.email_flows TO service_role;

ALTER TABLE public.email_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all flows" ON public.email_flows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY "Gerentes view all flows" ON public.email_flows
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'gerente'::app_role));

CREATE POLICY "SDRs manage own flows" ON public.email_flows
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'sdr'::app_role) AND created_by = public.get_profile_id(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'sdr'::app_role) AND created_by = public.get_profile_id(auth.uid()));

CREATE TRIGGER update_email_flows_updated_at BEFORE UPDATE ON public.email_flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- email_flow_steps
CREATE TABLE public.email_flow_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.email_flows(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 1,
  name TEXT,
  subject TEXT NOT NULL,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_html TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_flow_steps TO authenticated;
GRANT ALL ON public.email_flow_steps TO service_role;

ALTER TABLE public.email_flow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Flow steps follow flow perms" ON public.email_flow_steps
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.email_flows f WHERE f.id = flow_id AND (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'gerente'::app_role)
    OR f.created_by = public.get_profile_id(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.email_flows f WHERE f.id = flow_id AND (
    public.has_role(auth.uid(),'admin'::app_role)
    OR f.created_by = public.get_profile_id(auth.uid())
  )));

CREATE INDEX idx_email_flow_steps_flow ON public.email_flow_steps(flow_id, order_index);

CREATE TRIGGER update_email_flow_steps_updated_at BEFORE UPDATE ON public.email_flow_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- email_flow_recipients
CREATE TABLE public.email_flow_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.email_flows(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, lead_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_flow_recipients TO authenticated;
GRANT ALL ON public.email_flow_recipients TO service_role;

ALTER TABLE public.email_flow_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients follow flow perms" ON public.email_flow_recipients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.email_flows f WHERE f.id = flow_id AND (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'gerente'::app_role)
    OR f.created_by = public.get_profile_id(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.email_flows f WHERE f.id = flow_id AND (
    public.has_role(auth.uid(),'admin'::app_role)
    OR f.created_by = public.get_profile_id(auth.uid())
  )));

CREATE INDEX idx_email_flow_recipients_flow ON public.email_flow_recipients(flow_id);
CREATE INDEX idx_email_flow_recipients_lead ON public.email_flow_recipients(lead_id);

-- Migrar campanhas antigas
INSERT INTO public.email_flows (id, name, description, type, status, created_by, created_at, updated_at)
SELECT id, name, description, 'cadence', status, created_by, created_at, updated_at
FROM public.email_campaigns
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, body_html, blocks, delay_days, created_at, updated_at)
SELECT campaign_id, step_order, 'Passo ' || step_order, subject, body_html,
       jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type','text','html', body_html)),
       delay_days, created_at, updated_at
FROM public.email_steps;

-- Migrar listas de disparo antigas
INSERT INTO public.email_flows (id, name, description, type, status, created_by, created_at, updated_at)
SELECT id, name, NULL, 'blast', status, created_by, created_at, updated_at
FROM public.email_blast_lists
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.email_flow_steps (flow_id, order_index, name, subject, body_html, blocks, delay_days, created_at, updated_at)
SELECT id, 1, 'Disparo', subject, body_html,
       jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'type','text','html', body_html)),
       0, created_at, updated_at
FROM public.email_blast_lists;

INSERT INTO public.email_flow_recipients (flow_id, lead_id, status)
SELECT bl.id, unnest(bl.lead_ids), 'pending'
FROM public.email_blast_lists bl
WHERE array_length(bl.lead_ids, 1) > 0
ON CONFLICT DO NOTHING;
