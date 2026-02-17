
-- Add fonte column to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS fonte text DEFAULT 'manual';

-- Table to track CNPJ lookups
CREATE TABLE public.cnpj_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  razao_social text,
  nome_fantasia text,
  cnae_codigo text,
  cnae_descricao text,
  logradouro text,
  cidade text,
  estado text,
  telefone text,
  email text,
  dados_completos jsonb,
  consultado_por uuid NOT NULL,
  importado boolean DEFAULT false,
  lead_id uuid REFERENCES public.leads(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cnpj_consultas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all consultas" ON public.cnpj_consultas FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "SDRs can manage own consultas" ON public.cnpj_consultas FOR ALL USING (has_role(auth.uid(), 'sdr'::app_role) AND consultado_por = get_profile_id(auth.uid()));
CREATE POLICY "Gerentes can view all consultas" ON public.cnpj_consultas FOR SELECT USING (has_role(auth.uid(), 'gerente'::app_role));

CREATE INDEX idx_cnpj_consultas_cnpj ON public.cnpj_consultas(cnpj);
CREATE INDEX idx_cnpj_consultas_created ON public.cnpj_consultas(created_at);
