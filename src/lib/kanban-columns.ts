export type LeadStatus =
  | 'novo'
  | 'contato'
  | 'qualificado'
  | 'proposta'
  | 'negociacao'
  | 'ganho'
  | 'perdido';

export const LEAD_STATUSES: LeadStatus[] = [
  'novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido',
];

export interface KanbanColumn {
  id: LeadStatus;
  label: string;
  badgeClass: string;
}

// Colunas visíveis do board (pipeline ativo). 'perdido' fica na aba Descartados.
export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'novo',        label: 'Novo',        badgeClass: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  { id: 'contato',     label: 'Enriquecido', badgeClass: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  { id: 'qualificado', label: 'Email Enviado', badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  { id: 'proposta',    label: 'Proposta',    badgeClass: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  { id: 'negociacao',  label: 'Conversando', badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  { id: 'ganho',       label: 'Ganho',       badgeClass: 'bg-green-600/15 text-green-700 dark:text-green-300 border-green-600/40' },
];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  contato: 'Enriquecido',
  qualificado: 'Email Enviado',
  proposta: 'Proposta',
  negociacao: 'Conversando',
  ganho: 'Ganho',
  perdido: 'Descartado',
};

export interface GroupResult<T> {
  byColumn: Map<LeadStatus, T[]>;
  /** Leads cujo status não corresponde a nenhuma coluna do board (bug de dados). */
  orphans: T[];
}

/**
 * Agrupa leads pelas colunas do Kanban.
 * Garante que nenhum lead ativo seja descartado silenciosamente: leads com
 * status desconhecido vão para `orphans` para a UI destacar.
 */
export function groupLeadsByColumn<T extends { status: LeadStatus }>(
  leads: T[],
  columns: KanbanColumn[] = KANBAN_COLUMNS,
): GroupResult<T> {
  const byColumn = new Map<LeadStatus, T[]>();
  columns.forEach((c) => byColumn.set(c.id, []));
  const orphans: T[] = [];
  for (const lead of leads) {
    const bucket = byColumn.get(lead.status);
    if (bucket) bucket.push(lead);
    else orphans.push(lead);
  }
  return { byColumn, orphans };
}
