
-- Create meetings table
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sdr_id UUID NOT NULL REFERENCES public.profiles(id),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  title TEXT NOT NULL,
  description TEXT,
  meeting_date TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  jitsi_link TEXT NOT NULL,
  contact_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all meetings"
  ON public.meetings FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Gerentes can view all meetings
CREATE POLICY "Gerentes can view all meetings"
  ON public.meetings FOR SELECT
  USING (has_role(auth.uid(), 'gerente'::app_role));

-- SDRs can manage their own meetings
CREATE POLICY "SDRs can manage own meetings"
  ON public.meetings FOR ALL
  USING (has_role(auth.uid(), 'sdr'::app_role) AND (sdr_id = get_profile_id(auth.uid()) OR created_by = get_profile_id(auth.uid())));

-- SDRs can insert meetings
CREATE POLICY "SDRs can insert meetings"
  ON public.meetings FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'sdr'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
