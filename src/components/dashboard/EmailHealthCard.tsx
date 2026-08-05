import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, MailWarning, MailCheck, ShieldAlert } from 'lucide-react';

interface Metrics {
  sent: number;
  bounced: number;
  replies: number;
  domainsTotal: number;
  domainsVerified: number;
}

const PERIODS = [
  { id: '7', label: 'Últimos 7 dias' },
  { id: '30', label: 'Últimos 30 dias' },
  { id: '90', label: 'Últimos 90 dias' },
];

export function EmailHealthCard() {
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState<Metrics>({ sent: 0, bounced: 0, replies: 0, domainsTotal: 0, domainsVerified: 0 });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
        const [sent, bounced, replies, domains, verified] = await Promise.all([
          supabase.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'enviado').gte('sent_at', since),
          supabase.from('suppressed_emails').select('id', { count: 'exact', head: true }).gte('suppressed_at', since),
          supabase.from('email_inbox').select('id', { count: 'exact', head: true }).not('lead_id', 'is', null).gte('received_at', since),
          supabase.from('email_domains').select('id', { count: 'exact', head: true }),
          supabase.from('email_domains').select('id', { count: 'exact', head: true }).eq('status', 'verified'),
        ]);
        const err = [sent, bounced, replies, domains, verified].find(r => r.error)?.error;
        if (err) throw err;
        if (cancelled) return;
        setM({
          sent: sent.count ?? 0,
          bounced: bounced.count ?? 0,
          replies: replies.count ?? 0,
          domainsTotal: domains.count ?? 0,
          domainsVerified: verified.count ?? 0,
        });
      } catch (e) {
        console.error('Error loading email metrics:', e);
        toast.error('Erro ao carregar métricas de e-mail');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [days]);

  const pct = (n: number) => (m.sent > 0 ? ((n / m.sent) * 100).toFixed(1) : '0.0');
  const domainFail = m.domainsTotal > 0
    ? (((m.domainsTotal - m.domainsVerified) / m.domainsTotal) * 100).toFixed(0)
    : '0';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="font-display">Saúde dos Disparos</CardTitle>
          <CardDescription>Bounce, resposta e domínios remetentes</CardDescription>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">E-mails enviados</p>
              <p className="text-2xl font-bold">{m.sent}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <MailWarning className="h-3.5 w-3.5" /> Taxa de bounce
              </p>
              <p className="text-2xl font-bold text-destructive">{pct(m.bounced)}%</p>
              <p className="text-[11px] text-muted-foreground">{m.bounced} suprimidos no período</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <MailCheck className="h-3.5 w-3.5" /> Taxa de resposta
              </p>
              <p className="text-2xl font-bold text-success">{pct(m.replies)}%</p>
              <p className="text-[11px] text-muted-foreground">{m.replies} respostas vinculadas</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Domínios não verificados
              </p>
              <p className="text-2xl font-bold">{domainFail}%</p>
              <p className="text-[11px] text-muted-foreground">
                {m.domainsVerified} de {m.domainsTotal} verificados
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
