import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Mail, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Link } from 'react-router-dom';

interface InboxRow {
  id: string;
  from_email: string;
  to_email: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  lead_id: string | null;
  received_at: string;
}

interface LeadRef {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  email: string | null;
}

interface SendRow {
  id: string;
  lead_id: string;
  subject: string | null;
  body_html: string | null;
  sent_at: string | null;
}

export function InboxTab() {
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [leads, setLeads] = useState<Record<string, LeadRef>>({});
  const [sends, setSends] = useState<Record<string, SendRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [activeFromEmail, setActiveFromEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('email_inbox')
          .select('id, from_email, to_email, subject, html, text, lead_id, received_at')
          .order('received_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        const rows = (data ?? []) as InboxRow[];
        setInbox(rows);

        const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean))) as string[];
        if (leadIds.length) {
          const { data: leadData } = await supabase
            .from('leads')
            .select('id, razao_social, nome_fantasia, email')
            .in('id', leadIds);
          const map: Record<string, LeadRef> = {};
          (leadData ?? []).forEach((l) => { map[l.id] = l as LeadRef; });
          setLeads(map);

          // Fetch sends for these leads to build thread
          const { data: sendData } = await supabase
            .from('email_sends')
            .select('id, lead_id, sent_at, step_id')
            .in('lead_id', leadIds)
            .order('sent_at', { ascending: false });
          const stepIds = Array.from(new Set((sendData ?? []).map((s) => s.step_id).filter(Boolean))) as string[];
          const stepMap: Record<string, { subject: string; body_html: string }> = {};
          if (stepIds.length) {
            const { data: stepData } = await supabase
              .from('email_steps')
              .select('id, subject, body_html')
              .in('id', stepIds);
            (stepData ?? []).forEach((s) => { stepMap[s.id] = { subject: s.subject, body_html: s.body_html }; });
            // Also try new flow steps if any
            const { data: flowStepData } = await supabase
              .from('email_flow_steps')
              .select('id, subject, body_html')
              .in('id', stepIds);
            (flowStepData ?? []).forEach((s) => { stepMap[s.id] = { subject: s.subject, body_html: s.body_html }; });
          }
          const grouped: Record<string, SendRow[]> = {};
          (sendData ?? []).forEach((s) => {
            const step = stepMap[s.step_id];
            const row: SendRow = {
              id: s.id, lead_id: s.lead_id, sent_at: s.sent_at,
              subject: step?.subject ?? null, body_html: step?.body_html ?? null,
            };
            (grouped[s.lead_id] ??= []).push(row);
          });
          setSends(grouped);
        }
      } catch (e) {
        toast.error('Erro ao carregar caixa de entrada', { description: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; leadId: string | null; fromEmail: string; leadName: string; items: InboxRow[] }>();
    inbox.forEach((row) => {
      const key = row.lead_id ?? `email:${row.from_email}`;
      const lead = row.lead_id ? leads[row.lead_id] : null;
      const leadName = lead ? (lead.nome_fantasia || lead.razao_social) : row.from_email;
      if (!map.has(key)) map.set(key, { key, leadId: row.lead_id, fromEmail: row.from_email, leadName, items: [] });
      map.get(key)!.items.push(row);
    });
    return Array.from(map.values());
  }, [inbox, leads]);

  const activeGroup = grouped.find((g) => (activeLeadId ? g.leadId === activeLeadId : g.fromEmail === activeFromEmail));
  const activeLeadSends = activeGroup?.leadId ? (sends[activeGroup.leadId] ?? []) : [];

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (grouped.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
          Nenhuma resposta recebida ainda.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-[500px]">
      <Card className="p-2 max-h-[70vh] overflow-y-auto">
        {grouped.map((g) => {
          const isActive = activeGroup?.key === g.key;
          return (
            <button
              key={g.key}
              onClick={() => { setActiveLeadId(g.leadId); setActiveFromEmail(g.fromEmail); }}
              className={`w-full text-left p-3 rounded-md hover:bg-muted/50 transition ${isActive ? 'bg-primary/10 border border-primary/40' : ''}`}
            >
              <div className="flex justify-between items-start gap-2">
                <p className="font-medium text-sm truncate flex-1">{g.leadName}</p>
                <Badge variant="secondary" className="text-xs">{g.items.length}</Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">{g.fromEmail}</p>
              <p className="text-xs text-muted-foreground truncate mt-1">{g.items[0].subject || '(sem assunto)'}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {format(new Date(g.items[0].received_at), 'dd/MM/yy HH:mm', { locale: ptBR })}
              </p>
            </button>
          );
        })}
      </Card>

      <Card>
        {activeGroup ? (
          <>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{activeGroup.leadName}</CardTitle>
                  <CardDescription>{activeGroup.fromEmail}</CardDescription>
                </div>
                {activeGroup.leadId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/leads?highlight=${activeGroup.leadId}`}>
                      Ver lead <ExternalLink className="h-3 w-3 ml-1" />
                    </Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 max-h-[65vh] overflow-y-auto">
              {/* Interleave sends and inbox by date descending */}
              {(() => {
                type Item = { kind: 'sent' | 'received'; date: string; subject: string | null; html: string | null };
                const items: Item[] = [
                  ...activeLeadSends.filter((s) => s.sent_at).map((s) => ({
                    kind: 'sent' as const, date: s.sent_at as string, subject: s.subject, html: s.body_html,
                  })),
                  ...activeGroup.items.map((r) => ({
                    kind: 'received' as const, date: r.received_at, subject: r.subject, html: r.html ?? (r.text ? `<pre style="white-space:pre-wrap;font-family:inherit">${r.text}</pre>` : ''),
                  })),
                ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                return items.map((it, i) => (
                  <div key={i} className={`rounded-lg border p-3 ${it.kind === 'received' ? 'bg-success/5 border-success/30' : 'bg-muted/30'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <Badge variant={it.kind === 'received' ? 'default' : 'secondary'}>
                        {it.kind === 'received' ? '⬅ Resposta recebida' : '➡ Enviado'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(it.date), 'dd/MM/yy HH:mm', { locale: ptBR })}
                      </span>
                    </div>
                    {it.subject && <p className="font-medium text-sm mb-2">{it.subject}</p>}
                    <div className="prose prose-sm max-w-none text-sm" dangerouslySetInnerHTML={{ __html: it.html ?? '' }} />
                  </div>
                ));
              })()}
            </CardContent>
          </>
        ) : (
          <CardContent className="py-12 text-center text-muted-foreground">
            Selecione uma conversa à esquerda.
          </CardContent>
        )}
      </Card>
    </div>
  );
}
