/**
 * Variable substitution for email content. Supports lead fields.
 * Used both on the client (preview / test send) and mirrored on the server
 * (supabase/functions/send-email/index.ts).
 *
 * Keep the list here in sync with the server-side renderer.
 */

export interface EmailVariableContext {
  lead?: {
    nome?: string | null;         // nome_fantasia || razao_social
    empresa?: string | null;      // razao_social
    cidade?: string | null;
    email?: string | null;
    telefone?: string | null;
    setor?: string | null;
  } | null;
  sdr?: {
    nome?: string | null;
  } | null;
}

export interface VariableDef {
  token: string;   // '{{lead.nome}}'
  label: string;   // 'Nome do lead'
  example: string; // preview fallback
}

export const EMAIL_VARIABLES: VariableDef[] = [
  { token: '{{lead.nome}}',     label: 'Nome do lead',     example: 'Ana' },
  { token: '{{lead.empresa}}',  label: 'Empresa',          example: 'Transportes Ltda' },
  { token: '{{lead.cidade}}',   label: 'Cidade',           example: 'São Paulo' },
  { token: '{{lead.setor}}',    label: 'Setor',            example: 'Distribuição' },
  { token: '{{lead.email}}',    label: 'E-mail do lead',   example: 'contato@empresa.com' },
  { token: '{{lead.telefone}}', label: 'Telefone',         example: '(11) 99999-9999' },
  { token: '{{sdr.nome}}',      label: 'Nome do SDR',      example: 'Você' },
];

const MISSING = '';

function pick(ctx: EmailVariableContext, path: string, previewMode: boolean): string {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return MISSING;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null || cur === '') {
    if (previewMode) {
      const def = EMAIL_VARIABLES.find((v) => v.token === `{{${path}}}`);
      return def ? `[${def.label}]` : MISSING;
    }
    return MISSING;
  }
  return String(cur);
}

/**
 * Replaces {{lead.field}} / {{sdr.field}} tokens in the input string.
 * If previewMode is true, missing values are shown as `[Label]` placeholders.
 */
export function renderVariables(
  input: string,
  ctx: EmailVariableContext,
  opts: { previewMode?: boolean } = {},
): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, path: string) =>
    pick(ctx, path, opts.previewMode ?? false),
  );
}
