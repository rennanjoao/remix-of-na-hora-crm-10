
-- 1. lead_activities: audit log imutável
CREATE TABLE public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'status_change','note_added','email_sent','call_made','viewed',
    'meeting_scheduled','lead_created','lead_imported','whatsapp_sent',
    'campaign_enrolled','field_updated'
  )),
  description TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Grants
GRANT SELECT, INSERT ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;

-- 3. RLS
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- SELECT: SDR só vê atividades de seus próprios leads; admin/gerente veem tudo
CREATE POLICY "activities_select" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'gerente'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_activities.lead_id
        AND (
          l.assigned_to = public.get_profile_id(auth.uid())
          OR l.created_by = public.get_profile_id(auth.uid())
        )
    )
  );

-- INSERT: qualquer usuário autenticado; user_id deve ser o próprio profile
CREATE POLICY "activities_insert" ON public.lead_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NULL OR user_id = public.get_profile_id(auth.uid())
  );

-- Sem policies de UPDATE/DELETE => bloqueados por padrão (imutável)

-- 4. Índices
CREATE INDEX idx_lead_activities_lead_id ON public.lead_activities(lead_id, created_at DESC);
CREATE INDEX idx_lead_activities_user_created ON public.lead_activities(user_id, created_at DESC);
CREATE INDEX idx_lead_activities_created_at ON public.lead_activities(created_at DESC);
CREATE INDEX idx_lead_activities_action_type ON public.lead_activities(action_type);

-- 5. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities;
ALTER TABLE public.lead_activities REPLICA IDENTITY FULL;
