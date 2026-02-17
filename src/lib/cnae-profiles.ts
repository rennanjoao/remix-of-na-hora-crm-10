// CNAE-based cargo profiles for intelligent grouping

export interface CargoProfile {
  id: string;
  label: string;
  description: string;
  cnaePrefixes: string[];
}

export const CARGO_PROFILES: CargoProfile[] = [
  {
    id: 'alimentar_varejo',
    label: 'Setor Alimentar (Varejo)',
    description: 'Supermercados, mercearias, hortifruti, padarias',
    cnaePrefixes: ['4711', '4712', '4721', '4722', '4723', '4724', '4729'],
  },
  {
    id: 'alimentar_atacado',
    label: 'Setor Alimentar (Atacado)',
    description: 'Atacado de alimentos, bebidas, cereais',
    cnaePrefixes: ['4631', '4632', '4633', '4634', '4635', '4636', '4637', '4639'],
  },
  {
    id: 'vestuario',
    label: 'Vestuário e Têxtil',
    description: 'Atacado e varejo de roupas, tecidos, calçados',
    cnaePrefixes: ['4641', '4642', '4643', '4781', '4782', '1411', '1412', '1413', '1414'],
  },
  {
    id: 'construcao',
    label: 'Construção e Materiais',
    description: 'Materiais de construção, cimento, ferragens',
    cnaePrefixes: ['4741', '4742', '4743', '4744', '4679', '2320', '2330', '2341', '2342'],
  },
  {
    id: 'eletronicos',
    label: 'Eletrônicos e Informática',
    description: 'Comércio de eletrônicos, computadores, celulares',
    cnaePrefixes: ['4651', '4652', '4751', '4752', '4753', '4754', '2610', '2621', '2622'],
  },
  {
    id: 'quimicos',
    label: 'Químicos e Farmacêuticos',
    description: 'Produtos químicos, farmacêuticos, cosméticos',
    cnaePrefixes: ['4644', '4645', '4646', '4647', '4771', '4772', '4773', '2011', '2012', '2013', '2110'],
  },
  {
    id: 'agro',
    label: 'Agronegócio',
    description: 'Insumos agrícolas, fertilizantes, sementes',
    cnaePrefixes: ['4611', '4612', '4613', '4621', '4622', '4623', '0111', '0112', '0113', '0121'],
  },
  {
    id: 'combustiveis',
    label: 'Combustíveis e Derivados',
    description: 'Postos, distribuidoras de combustíveis, gás',
    cnaePrefixes: ['4681', '4682', '4731', '1921', '1922'],
  },
  {
    id: 'moveis',
    label: 'Móveis e Decoração',
    description: 'Fabricação e comércio de móveis, colchões',
    cnaePrefixes: ['4754', '4755', '4756', '4759', '3101', '3102', '3103', '3104'],
  },
  {
    id: 'automotivo',
    label: 'Automotivo',
    description: 'Peças, veículos, oficinas, concessionárias',
    cnaePrefixes: ['4511', '4512', '4520', '4530', '4541', '4542', '4543', '2910', '2920', '2930'],
  },
];

export function matchCargoProfiles(cnaeCodigo: string): CargoProfile[] {
  if (!cnaeCodigo) return [];
  const code = cnaeCodigo.replace(/[.\-/]/g, '');
  return CARGO_PROFILES.filter(p => p.cnaePrefixes.some(prefix => code.startsWith(prefix)));
}

export function getProfileSummary(companies: { cnae_codigo?: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of companies) {
    const profiles = matchCargoProfiles(c.cnae_codigo || '');
    for (const p of profiles) {
      counts[p.id] = (counts[p.id] || 0) + 1;
    }
  }
  return counts;
}

// CNAE niche filter presets
export const NICHE_FILTERS = [
  { label: 'Atacadista', prefixes: ['461', '462', '463', '464', '465', '466', '467', '468', '469'] },
  { label: 'Varejista', prefixes: ['471', '472', '473', '474', '475', '476', '477', '478'] },
  { label: 'Mercado/Supermercado', prefixes: ['4711', '4712'] },
  { label: 'Indústria de Alimentos', prefixes: ['10'] },
  { label: 'Indústria Têxtil', prefixes: ['13', '14'] },
  { label: 'Indústria Química', prefixes: ['20', '21'] },
  { label: 'Transportadora', prefixes: ['491', '492', '493'] },
] as const;

export const PORTE_OPTIONS = [
  { value: 'MEI', label: 'MEI' },
  { value: 'ME', label: 'ME - Microempresa' },
  { value: 'EPP', label: 'EPP - Empresa de Pequeno Porte' },
  { value: 'DEMAIS', label: 'Demais' },
] as const;

export const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
] as const;
