import { BrasilAPICompany } from '@/hooks/useBrasilAPI';
import { classificarCNAE, SETOR_CONFIG, isAltoPotencialLogistica } from '@/lib/cnae-classifier';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { MapPin, Truck, CheckCircle, XCircle } from 'lucide-react';

interface MiningLeadRowProps {
  company: BrasilAPICompany;
  cnpj: string;
  selected: boolean;
  isActive: boolean;
  hotZoneBairros: Set<string>;
  onToggle: () => void;
  onClick: () => void;
  isHighlighted: boolean;
  isNextInQueue?: boolean;
}

export function MiningLeadRow({ company, cnpj, selected, hotZoneBairros, onToggle, onClick, isHighlighted, isNextInQueue }: MiningLeadRowProps) {
  const cnaeCode = String(company.cnae_fiscal);
  const setor = classificarCNAE(cnaeCode);
  const config = SETOR_CONFIG[setor];
  const altoPotencial = isAltoPotencialLogistica(cnaeCode);
  const isAtiva = company.situacao_cadastral === 2;
  const isHotZone = company.bairro && hotZoneBairros.has(company.bairro.toUpperCase());

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-3 py-2.5 cursor-pointer rounded-lg transition-all border',
        isHighlighted
          ? 'bg-primary/10 border-primary/30'
          : 'border-transparent hover:bg-muted/60 hover:border-border',
        isHotZone && !isHighlighted && 'border-l-2 border-l-amber-400/60',
        isNextInQueue && !isHighlighted && 'ring-1 ring-primary/40 animate-pulse'
      )}
      onClick={onClick}
    >
      <div className="pt-0.5" onClick={e => { e.stopPropagation(); onToggle(); }}>
        <Checkbox checked={selected} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate leading-tight">
              {company.nome_fantasia || company.razao_social}
            </p>
            {company.nome_fantasia && (
              <p className="text-xs text-muted-foreground truncate">{company.razao_social}</p>
            )}
          </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
            {isAtiva ? (
              <CheckCircle className="h-3.5 w-3.5 text-accent" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {company.bairro && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {company.bairro}
              {isHotZone && <span className="text-warning">🔥</span>}
            </span>
          )}
          <Badge className={cn(config.color, 'text-xs py-0')}>{config.label}</Badge>
          {altoPotencial && (
            <Badge variant="outline" className="text-xs py-0 gap-1 border-primary/40 text-primary">
              <Truck className="h-2.5 w-2.5" />
              Alto Pot.
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
