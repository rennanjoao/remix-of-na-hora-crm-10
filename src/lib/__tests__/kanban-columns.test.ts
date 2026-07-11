import { describe, it, expect } from 'vitest';
import {
  groupLeadsByColumn,
  KANBAN_COLUMNS,
  LEAD_STATUSES,
  type LeadStatus,
} from '../kanban-columns';

interface L { id: string; status: LeadStatus }

describe('groupLeadsByColumn', () => {
  it('cria um bucket para cada coluna definida', () => {
    const { byColumn } = groupLeadsByColumn<L>([]);
    for (const col of KANBAN_COLUMNS) expect(byColumn.get(col.id)).toEqual([]);
  });

  it('distribui leads pelos respectivos status', () => {
    const leads: L[] = [
      { id: '1', status: 'novo' },
      { id: '2', status: 'proposta' },
      { id: '3', status: 'ganho' },
      { id: '4', status: 'negociacao' },
    ];
    const { byColumn, orphans } = groupLeadsByColumn(leads);
    expect(byColumn.get('novo')!.map((l) => l.id)).toEqual(['1']);
    expect(byColumn.get('proposta')!.map((l) => l.id)).toEqual(['2']);
    expect(byColumn.get('ganho')!.map((l) => l.id)).toEqual(['3']);
    expect(byColumn.get('negociacao')!.map((l) => l.id)).toEqual(['4']);
    expect(orphans).toEqual([]);
  });

  it('nunca descarta leads silenciosamente — status fora do board vira orphan', () => {
    const leads = [{ id: 'x', status: 'inexistente' as unknown as LeadStatus }];
    const { orphans } = groupLeadsByColumn(leads);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe('x');
  });

  it('todos os status ativos do enum têm coluna correspondente', () => {
    const activeStatuses = LEAD_STATUSES.filter((s) => s !== 'perdido');
    for (const status of activeStatuses) {
      const has = KANBAN_COLUMNS.some((c) => c.id === status);
      expect(has, `coluna para ${status}`).toBe(true);
    }
  });
});
