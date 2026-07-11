-- Item 13: SDR pode ver respostas dos leads atribuídos/criados por ele; gerente vê tudo.
DROP POLICY IF EXISTS "Admin views all inbox" ON public.email_inbox;
DROP POLICY IF EXISTS "Admins can view email_inbox" ON public.email_inbox;
DROP POLICY IF EXISTS "email_inbox_select" ON public.email_inbox;

CREATE POLICY "email_inbox_select_by_role_or_owner"
ON public.email_inbox
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'gerente'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = email_inbox.lead_id
      AND (
        l.assigned_to = public.get_profile_id(auth.uid())
        OR l.created_by = public.get_profile_id(auth.uid())
      )
  )
);

-- Item 7 (opcional): coluna para sinalizar alto engajamento de e-mail sem mudar status.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS alto_engajamento_email boolean NOT NULL DEFAULT false;