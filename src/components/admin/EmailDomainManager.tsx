import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Loader2, RefreshCw, Globe, CheckCircle2, Clock } from 'lucide-react';

interface DnsRecord {
  record?: string;
  name?: string;
  type?: string;
  value?: string;
  ttl?: string | number;
  priority?: number;
  status?: string;
}

interface EmailDomain {
  id: string;
  domain: string;
  resend_domain_id: string | null;
  status: string;
  dns_records: DnsRecord[] | null;
  webhook_id: string | null;
  verified_at: string | null;
  created_at: string;
}

export function EmailDomainManager() {
  const [domains, setDomains] = useState<EmailDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [registering, setRegistering] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const fetchDomains = async () => {
    try {
      const { data, error } = await supabase
        .from('email_domains')
        .select('id, domain, resend_domain_id, status, dns_records, webhook_id, verified_at, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDomains((data ?? []) as unknown as EmailDomain[]);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar domínios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  const handleRegister = async () => {
    const domain = newDomain.trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      toast.error('Informe um domínio válido (ex: empresa.com.br)');
      return;
    }
    setRegistering(true);
    try {
      const { data, error } = await supabase.functions.invoke('register-email-domain', {
        body: { domain },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Domínio registrado. Configure os DNS abaixo.');
      setNewDomain('');
      fetchDomains();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar domínio';
      toast.error(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleVerify = async (id: string) => {
    setVerifyingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('verify-email-domain', {
        body: { domain_id: id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const status = data?.domain?.status ?? 'pending';
      toast.success(status === 'verified' ? 'Domínio verificado!' : `Status: ${status}`);
      fetchDomains();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao verificar';
      toast.error(msg);
    } finally {
      setVerifyingId(null);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copiado');
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'verified') {
      return (
        <Badge className="bg-success text-success-foreground gap-1">
          <CheckCircle2 className="h-3 w-3" /> Verificado
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" /> {status || 'pendente'}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" /> Registrar novo domínio
          </CardTitle>
          <CardDescription>
            Adicione o domínio de onde os e-mails serão enviados. Você receberá os registros DNS
            para configurar no seu provedor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="empresa.com.br"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              disabled={registering}
            />
            <Button onClick={handleRegister} disabled={registering || !newDomain}>
              {registering && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Registrar domínio
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : domains.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum domínio configurado ainda.
          </CardContent>
        </Card>
      ) : (
        domains.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-3">
                    {d.domain} {statusBadge(d.status)}
                  </CardTitle>
                  <CardDescription>
                    {d.verified_at
                      ? `Verificado em ${new Date(d.verified_at).toLocaleString('pt-BR')}`
                      : 'Adicione os registros DNS abaixo no painel do seu provedor de DNS e clique em "Verificar propagação".'}
                    {d.webhook_id && ' · Webhook de recebimento ativo.'}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => handleVerify(d.id)}
                  disabled={verifyingId === d.id}
                >
                  {verifyingId === d.id ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Verificar propagação
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {d.dns_records && d.dns_records.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Nome / Host</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>TTL / Prio</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.dns_records.map((r, i) => {
                      const type = r.type ?? r.record ?? '—';
                      const name = r.name ?? '—';
                      const value = r.value ?? '';
                      return (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{type}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[200px]">{name}</span>
                              <Button size="icon" variant="ghost" onClick={() => copy(name)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[280px]">{value}</span>
                              <Button size="icon" variant="ghost" onClick={() => copy(value)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.ttl ?? 'Auto'}
                            {r.priority !== undefined ? ` / ${r.priority}` : ''}
                          </TableCell>
                          <TableCell>
                            <Badge variant={r.status === 'verified' ? 'default' : 'secondary'}>
                              {r.status ?? '—'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum registro DNS retornado.</p>
              )}
              <p className="text-xs text-muted-foreground mt-4">
                Cole cada valor exatamente como mostrado no painel do seu provedor de DNS
                (Registro.br, Cloudflare, GoDaddy etc). A propagação pode levar de minutos a
                horas.
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
