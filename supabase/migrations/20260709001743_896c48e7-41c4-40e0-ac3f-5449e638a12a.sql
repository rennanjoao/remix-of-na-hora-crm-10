
-- email_domains
CREATE TABLE public.email_domains (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  resend_domain_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  dns_records JSONB DEFAULT '[]'::jsonb,
  webhook_id TEXT,
  verified_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_domains TO authenticated;
GRANT ALL ON public.email_domains TO service_role;

ALTER TABLE public.email_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email domains"
  ON public.email_domains FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_email_domains_updated_at
  BEFORE UPDATE ON public.email_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- email_inbox
CREATE TABLE public.email_inbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_email TEXT NOT NULL,
  to_email TEXT,
  subject TEXT,
  html TEXT,
  text TEXT,
  resend_email_id TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_inbox TO authenticated;
GRANT ALL ON public.email_inbox TO service_role;

ALTER TABLE public.email_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email inbox"
  ON public.email_inbox FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_email_inbox_from ON public.email_inbox(from_email);
CREATE INDEX idx_email_inbox_lead ON public.email_inbox(lead_id);

CREATE TRIGGER update_email_inbox_updated_at
  BEFORE UPDATE ON public.email_inbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
