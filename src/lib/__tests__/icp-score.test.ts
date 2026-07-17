import { describe, it, expect } from 'vitest';
import { scoreIcp } from '../icp-score';

describe('scoreIcp', () => {
  it('dá tier A para lead completo (rating alto + reviews + email + setor match)', () => {
    const r = scoreIcp({
      rating: 4.8,
      ratingCount: 500,
      emailConfidence: 'high',
      searchTerm: 'Transportadora em Guarulhos',
      category: 'Transportadora',
    });
    expect(r.tier).toBe('A');
    expect(r.total).toBeGreaterThanOrEqual(75);
  });

  it('dá tier C para lead sem sinais', () => {
    const r = scoreIcp({
      rating: null,
      ratingCount: null,
      emailConfidence: null,
      searchTerm: 'Transportadora',
      category: null,
    });
    expect(r.tier).toBe('C');
    expect(r.total).toBeLessThan(50);
  });

  it('penaliza quando setor não bate com a busca', () => {
    const match = scoreIcp({ rating: 4.5, ratingCount: 100, emailConfidence: 'high', searchTerm: 'transportadora', category: 'Transportadora rodoviária' });
    const off  = scoreIcp({ rating: 4.5, ratingCount: 100, emailConfidence: 'high', searchTerm: 'transportadora', category: 'Restaurante japonês' });
    expect(match.total).toBeGreaterThan(off.total);
    expect(match.breakdown.sector).toBeGreaterThan(off.breakdown.sector);
  });

  it('ignora palavras de conexão ("em", "de") ao comparar setor', () => {
    const r = scoreIcp({
      rating: 4.0, ratingCount: 20,
      emailConfidence: 'medium',
      searchTerm: 'distribuidora em santos',
      category: 'Distribuidora',
    });
    expect(r.breakdown.sector).toBe(25);
  });

  it('reviews contribuem em escala logarítmica', () => {
    const few = scoreIcp({ rating: 4, ratingCount: 10, emailConfidence: null, searchTerm: 'x', category: null });
    const many = scoreIcp({ rating: 4, ratingCount: 1000, emailConfidence: null, searchTerm: 'x', category: null });
    expect(many.breakdown.reviews).toBeGreaterThan(few.breakdown.reviews);
    expect(many.breakdown.reviews).toBeLessThanOrEqual(20);
  });
});
