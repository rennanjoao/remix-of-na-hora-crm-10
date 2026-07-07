import { useEffect } from 'react';
import { BrasilAPICompany } from '@/hooks/useBrasilAPI';
import { classificarCNAE, isAltoPotencialLogistica, SETOR_CONFIG } from '@/lib/cnae-classifier';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, Download, Mail, MessageCircle, Building2, MapPin, Phone, AtSign, Truck, AlertTriangle, Hash, Calendar, DollarSign, Users } from 'lucide-react';

interface LeadDetailPanelProps {
  company: BrasilAPICompany;
  onImport: () => void;
  importing: boolean;
  alreadyImported: boolean;
  onStartEmailFlow?: () => void;
  onSendWhatsApp?: () => void;
}

function formatCNPJ(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatCapital(value: number): string {
  if (!value) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function isValidEmail(email: string | null): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function LeadDetailPanel({ company, onImport, importing, alreadyImported, onStartEmailFlow, onSendWhatsApp }: LeadDetailPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Enter' && !importing && !alreadyImported) {
        e.preventDefault();
        onImport();
      }
      if ((e.key === 'w' || e.key === 'W') && alreadyImported && onSendWhatsApp) {
        e.preventDefault();
        onSendWhatsApp();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [importing, alreadyImported, onImport, onSendWhatsApp]);

  const cnaeCode = String(company.cnae_fiscal);

  const setor = classificarCNAE(cnaeCode);
  const altoPotencial = isAltoPotencialLogistica(cnaeCode);
  const config = SETOR_CONFIG[setor];
  const emailValido = isValidEmail(company.email);
  const telefone = company.ddd_telefone_1 || company.ddd_telefone_2;
  const isAtiva = company.situacao_cadastral === 2;

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold leading-tight truncate">
              {company.nome_fantasia || company.razao_social}
            </h2>
            {company.nome_fantasia && (
              <p className="text-xs text-muted-foreground truncate">{company.razao_social}</p>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Badge className={config.color + ' text-xs'}>{config.label}</Badge>
            {altoPotencial && (
              <Badge variant="default" className="gap-1 text-xs">
                <Truck className="h-3 w-3" />
                Alto Potencial
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAtiva ? (
            <Badge variant="outline" className="gap-1 text-xs border-accent/50 text-accent">
              ● Ativa
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-xs gap-1">
              ● {company.descricao_situacao_cadastral}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{company.porte || 'Porte não informado'}</span>
        </div>
      </div>

      <Separator />

      {/* Details grid */}
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <Hash className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">CNPJ</p>
            <p className="text-sm font-mono">{formatCNPJ(company.cnpj)}</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Building2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">CNAE Principal</p>
            <p className="text-sm">{cnaeCode} – {company.cnae_fiscal_descricao}</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Endereço</p>
            <p className="text-sm">{company.logradouro}{company.numero ? `, ${company.numero}` : ''}</p>
            {company.bairro && <p className="text-xs text-muted-foreground">{company.bairro}</p>}
            <p className="text-xs text-muted-foreground">{company.municipio}/{company.uf} — CEP {company.cep}</p>
          </div>
        </div>

        {telefone && (
          <div className="flex items-start gap-2.5">
            <Phone className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="text-sm">{telefone}</p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-2.5">
          <AtSign className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">E-mail</p>
            {emailValido ? (
              <p className="text-sm">{company.email}</p>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-destructive" />
                Não disponível
              </p>
            )}
          </div>
        </div>

        {company.capital_social > 0 && (
          <div className="flex items-start gap-2.5">
            <DollarSign className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Capital Social</p>
              <p className="text-sm">{formatCapital(company.capital_social)}</p>
            </div>
          </div>
        )}

        {company.data_inicio_atividade && (
          <div className="flex items-start gap-2.5">
            <Calendar className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Início das Atividades</p>
              <p className="text-sm">{company.data_inicio_atividade}</p>
            </div>
          </div>
        )}

        {company.natureza_juridica && (
          <div className="flex items-start gap-2.5">
            <Users className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Natureza Jurídica</p>
              <p className="text-sm">{company.natureza_juridica}</p>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Actions */}
      <div className="space-y-2 pb-2">
        {!alreadyImported ? (
          <Button className="w-full" onClick={onImport} disabled={importing}>
            {importing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importando...</>
            ) : (
              <><Download className="h-4 w-4 mr-2" />Importar para o Funil</>
            )}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 rounded-md bg-muted/60 py-2">
              <span className="text-xs text-muted-foreground">✓ Já importado para o CRM</span>
            </div>
            {emailValido && onStartEmailFlow && (
              <Button variant="outline" size="sm" className="w-full" onClick={onStartEmailFlow}>
                <Mail className="h-4 w-4 mr-2" />
                Iniciar Fluxo de E-mail
              </Button>
            )}
            {telefone && onSendWhatsApp && (
              <Button variant="outline" size="sm" className="w-full" onClick={onSendWhatsApp}>
                <MessageCircle className="h-4 w-4 mr-2" />
                Enviar WhatsApp
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
