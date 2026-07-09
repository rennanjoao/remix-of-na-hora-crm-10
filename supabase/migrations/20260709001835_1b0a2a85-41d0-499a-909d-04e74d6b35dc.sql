
ALTER TABLE public.email_domains
  ADD COLUMN IF NOT EXISTS webhook_signing_secret TEXT;
