// CNAE sector classification for logistics intelligence
const LOGISTICS_CNAES = ['4911', '4912', '4921', '4922', '4923', '4924', '4929', '4930', '5011', '5012', '5021', '5022', '5030', '5111', '5112', '5120', '5211', '5212', '5221', '5222', '5223', '5229', '5231', '5232', '5239', '5240', '5250'];
const INDUSTRIA_CNAES = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];
const COMERCIO_CNAES = ['45', '46', '47'];

export type SetorTag = 'logistica' | 'industria' | 'comercio' | 'outros';

export function classificarCNAE(cnaeCodigo: string): SetorTag {
  if (!cnaeCodigo) return 'outros';
  const code = cnaeCodigo.replace(/[.\-/]/g, '');

  if (LOGISTICS_CNAES.some(c => code.startsWith(c))) return 'logistica';
  if (INDUSTRIA_CNAES.some(c => code.startsWith(c))) return 'industria';
  if (COMERCIO_CNAES.some(c => code.startsWith(c))) return 'comercio';
  return 'outros';
}

export function isAltoPotencialLogistica(cnaeCodigo: string): boolean {
  const setor = classificarCNAE(cnaeCodigo);
  return setor === 'logistica' || setor === 'industria';
}

export const SETOR_CONFIG: Record<SetorTag, { label: string; color: string }> = {
  logistica: { label: 'Logística', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  industria: { label: 'Indústria', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  comercio: { label: 'Comércio', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  outros: { label: 'Outros', color: 'bg-muted text-muted-foreground' },
};
