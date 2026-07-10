// Server-side mirror of src/lib/email-variables.ts. Keep in sync.

export interface EmailVarCtx {
  lead?: Record<string, unknown> | null;
  sdr?: Record<string, unknown> | null;
}

export function renderVariables(input: string, ctx: EmailVarCtx): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_m, path: string) => {
    const parts = path.split('.');
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur == null ? '' : String(cur);
  });
}

/** Build lead variables from a leads row. */
export function leadToVars(lead: Record<string, unknown> | null): Record<string, string> {
  if (!lead) return {};
  const nomeFantasia = (lead.nome_fantasia as string | null) ?? null;
  const razao = (lead.razao_social as string | null) ?? null;
  return {
    nome: nomeFantasia || razao || '',
    empresa: razao || nomeFantasia || '',
    cidade: (lead.cidade as string | null) ?? '',
    setor: (lead.setor as string | null) ?? '',
    email: (lead.email as string | null) ?? '',
    telefone: (lead.telefone as string | null) ?? '',
  };
}
