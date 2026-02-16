
-- Add type/status to meetings for instant vs scheduled
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS meeting_type text NOT NULL DEFAULT 'scheduled';
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'agendada';

-- Email Campaigns table
CREATE TABLE public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'rascunho',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all campaigns" ON public.email_campaigns
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "SDRs can manage own campaigns" ON public.email_campaigns
  FOR ALL TO authenticated USING (
    has_role(auth.uid(), 'sdr') AND created_by = get_profile_id(auth.uid())
  );

CREATE POLICY "Gerentes can view all campaigns" ON public.email_campaigns
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'gerente'));

-- Email Steps (sequence steps within a campaign)
CREATE TABLE public.email_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  subject text NOT NULL,
  body_html text NOT NULL,
  delay_days integer NOT NULL DEFAULT 0,
  step_type text NOT NULL DEFAULT 'initial',
  condition_type text,
  condition_ref_step_id uuid REFERENCES public.email_steps(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all steps" ON public.email_steps
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "SDRs can manage own campaign steps" ON public.email_steps
  FOR ALL TO authenticated USING (
    has_role(auth.uid(), 'sdr') AND EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = email_steps.campaign_id AND c.created_by = get_profile_id(auth.uid())
    )
  );

CREATE POLICY "Gerentes can view all steps" ON public.email_steps
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'gerente'));

-- Email Sends (individual sends to leads)
CREATE TABLE public.email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.email_steps(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sdr_id uuid NOT NULL,
  tracking_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pendente',
  sent_at timestamptz,
  scheduled_for timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  replied boolean NOT NULL DEFAULT false,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all sends" ON public.email_sends
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "SDRs can manage own sends" ON public.email_sends
  FOR ALL TO authenticated USING (
    has_role(auth.uid(), 'sdr') AND sdr_id = get_profile_id(auth.uid())
  );

CREATE POLICY "Gerentes can view all sends" ON public.email_sends
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'gerente'));

-- Triggers for updated_at
CREATE TRIGGER update_email_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_email_steps_updated_at BEFORE UPDATE ON public.email_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add DELETE policy to meetings for SDRs
CREATE POLICY "SDRs can delete own meetings" ON public.meetings
  FOR DELETE TO authenticated USING (
    has_role(auth.uid(), 'sdr') AND (sdr_id = get_profile_id(auth.uid()) OR created_by = get_profile_id(auth.uid()))
  );
