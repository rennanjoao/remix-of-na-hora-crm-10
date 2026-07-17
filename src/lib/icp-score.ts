// Score de fit (ICP) para resultados do Google Places.
// Combina sinais objetivos em uma nota 0-100 para o SDR priorizar quem atacar primeiro.
//
// Componentes (pesos somam ~100 no caso ótimo):
//   • Rating do Google  → até 25 pts (rating * 5)
//   • Volume de reviews → até 20 pts (log10(count) * 8, limitado)
//   • E-mail encontrado → até 30 pts (alta=30 / média=20 / manual=25 / nenhum=0)
//   • Aderência de setor → até 25 pts (match completo=25, parcial=15, nenhum=5)

export interface IcpInput {
  rating: number | null;
  ratingCount: number | null;
  emailConfidence: 'high' | 'medium' | 'manual' | null;
  searchTerm: string;
  category: string | null;
}

export interface IcpScore {
  total: number;             // 0-100
  tier: 'A' | 'B' | 'C';     // A: 75+, B: 50-74, C: <50
  breakdown: {
    rating: number;
    reviews: number;
    email: number;
    sector: number;
  };
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ignora conectores/localidades comuns na busca ("distribuidora em santos" → ["distribuidora"])
const STOP = new Set([
  'em','de','da','do','para','no','na','os','as','o','a','com','sem',
  'zona','centro','leste','oeste','sul','norte','interior',
]);

function contentWords(s: string): string[] {
  return norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
}

export function scoreIcp(input: IcpInput): IcpScore {
  // Rating
  const rating = input.rating != null
    ? Math.min(25, Math.max(0, input.rating * 5))
    : 0;

  // Reviews (log-scale: 10 reviews ≈ 8pt, 100 ≈ 16pt, 1000 ≈ 20pt)
  const reviews = input.ratingCount != null && input.ratingCount > 0
    ? Math.min(20, Math.log10(input.ratingCount + 1) * 8)
    : 0;

  // E-mail
  const email = input.emailConfidence === 'high' ? 30
    : input.emailConfidence === 'manual' ? 25
    : input.emailConfidence === 'medium' ? 20
    : 0;

  // Setor
  let sector = 5;
  if (input.category) {
    const catWords = new Set(contentWords(input.category));
    const termWords = contentWords(input.searchTerm);
    if (termWords.length > 0) {
      const hits = termWords.filter(w => catWords.has(w)).length;
      const ratio = hits / termWords.length;
      sector = ratio >= 0.6 ? 25 : ratio > 0 ? 15 : 5;
    }
  }

  const total = Math.round(rating + reviews + email + sector);
  const tier: IcpScore['tier'] = total >= 75 ? 'A' : total >= 50 ? 'B' : 'C';

  return {
    total,
    tier,
    breakdown: {
      rating: Math.round(rating),
      reviews: Math.round(reviews),
      email,
      sector,
    },
  };
}
