CREATE TABLE public.email_blast_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  template_step_id uuid REFERENCES public.email_steps(id) ON DELETE SET NULL,
  lead_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'rascunho',
  sent_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_blast_lists TO authenticated;
GRANT ALL ON public.email_blast_lists TO service_role;

ALTER TABLE public.email_blast_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SDR gerencia suas listas de disparo"
ON public.email_blast_lists
FOR ALL
TO authenticated
USING (
  created_by = public.get_profile_id(auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
)
WITH CHECK (
  created_by = public.get_profile_id(auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE INDEX idx_email_blast_lists_created_by ON public.email_blast_lists(created_by);
CREATE INDEX idx_email_blast_lists_created_at ON public.email_blast_lists(created_at DESC);

CREATE TRIGGER update_email_blast_lists_updated_at
BEFORE UPDATE ON public.email_blast_lists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();