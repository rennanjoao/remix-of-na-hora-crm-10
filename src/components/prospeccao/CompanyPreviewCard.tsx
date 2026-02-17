import { BrasilAPICompany } from '@/hooks/useBrasilAPI';
import { classificarCNAE, isAltoPotencialLogistica, SETOR_CONFIG } from '@/lib/cnae-classifier';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Mail, MessageCircle, Building2, MapPin, Phone, AtSign, Truck, AlertTriangle } from 'lucide-react';

interface CompanyPreviewCardProps {
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

function isValidEmail(email: string | null): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function CompanyPreviewCard({ company, onImport, importing, alreadyImported, onStartEmailFlow, onSendWhatsApp }: CompanyPreviewCardProps) {
  const cnaeCode = String(company.cnae_fiscal);
  const setor = classificarCNAE(cnaeCode);
  const altoPotencial = isAltoPotencialLogistica(cnaeCode);
  const config = SETOR_CONFIG[setor];
  const emailValido = isValidEmail(company.email);
  const telefone = company.ddd_telefone_1 || company.ddd_telefone_2;

  return (
    <Card className={altoPotencial ? 'border-primary/50 shadow-md' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 shrink-0" />
              {company.razao_social}
            </CardTitle>
            {company.nome_fantasia && (
              <p className="text-sm text-muted-foreground mt-1">{company.nome_fantasia}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={config.color}>{config.label}</Badge>
            {altoPotencial && (
              <Badge variant="default" className="gap-1">
                <Truck className="h-3 w-3" />
                Alto Potencial
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">CNPJ</p>
            <p className="font-mono">{formatCNPJ(company.cnpj)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">CNAE Principal</p>
            <p>{cnaeCode} – {company.cnae_fiscal_descricao}</p>
          </div>
          <div className="flex items-start gap-1.5">
            <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
            <div>
              <p>{company.logradouro}{company.numero ? `, ${company.numero}` : ''}</p>
              <p className="text-muted-foreground">{company.municipio}/{company.uf}</p>
            </div>
          </div>
          <div className="space-y-1">
            {telefone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{telefone}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
              {emailValido ? (
                <span>{company.email}</span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  E-mail não disponível
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          {!alreadyImported ? (
            <Button onClick={onImport} disabled={importing}>
              {importing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importando...</>
              ) : (
                <><Download className="h-4 w-4 mr-2" />Importar para o CRM</>
              )}
            </Button>
          ) : (
            <>
              <Badge variant="secondary" className="py-1.5 px-3">✓ Já importado</Badge>
              {emailValido && onStartEmailFlow && (
                <Button variant="outline" size="sm" onClick={onStartEmailFlow}>
                  <Mail className="h-4 w-4 mr-2" />Iniciar Fluxo de Boas-Vindas
                </Button>
              )}
              {telefone && onSendWhatsApp && (
                <Button variant="outline" size="sm" onClick={onSendWhatsApp}>
                  <MessageCircle className="h-4 w-4 mr-2" />Enviar WhatsApp
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
