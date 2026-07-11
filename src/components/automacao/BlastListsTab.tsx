import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Send, Save } from 'lucide-react';
import { FlowManager } from './FlowManager';
import { LEAD_STATUSES } from '@/lib/kanban-columns';

interface Lead {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  email: string | null;
  status: string | null;
  fonte: string | null;
  cidade: string | null;
}

interface BlastFlow {
  id: string;
  name: string;
}

const PAGE_SIZE = 200;

export function BlastListsTab() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters (server-side)
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);

  const [flows, setFlows] = useState<BlastFlow[]>([]);
  const [targetFlow, setTargetFlow] = useState<string>('');
  const [enqueueing, setEnqueueing] = useState(false);

  // Load flows once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('email_flows').select('id, name')
        .eq('type', 'blast').order('created_at', { ascending: false });
      setFlows((data ?? []) as BlastFlow[]);
    })();
  }, []);

  // Server-side leads query (debounced)
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('leads')
          .select('id, razao_social, nome_fantasia, email, status, fonte, cidade', { count: 'exact' })
          .order('updated_at', { ascending: false })
          .range(0, PAGE_SIZE - 1);
        if (onlyWithEmail) query = query.not('email', 'is', null);
        if (status !== 'all') query = query.eq('status', status as never);
        const term = search.trim();
        if (term) {
          const like = `%${term}%`;
          query = query.or(`razao_social.ilike.${like},nome_fantasia.ilike.${like},email.ilike.${like}`);
        }
        const { data, count, error } = await query;
        if (error) throw error;
        setLeads((data ?? []) as Lead[]);
        setTotal(count ?? 0);
      } catch (e) {
        toast.error('Erro ao carregar leads', { description: e instanceof Error ? e.message : String(e) });
      } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [search, status, onlyWithEmail]);

  const filtered = leads;
  const statuses = useMemo(() => LEAD_STATUSES.filter((s) => s !== 'perdido'), []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };

  const saveAsList = async () => {
    if (!profile || selected.size === 0) return;
    const name = prompt('Nome do disparo:');
    if (!name) return;
    try {
      const { data: flow, error } = await supabase.from('email_flows').insert({
        name, type: 'blast', status: 'rascunho', created_by: profile.id,
      }).select().single();
      if (error) throw error;
      const rows = Array.from(selected).map((lead_id) => ({ flow_id: flow.id, lead_id, status: 'pending' }));
      const { error: rErr } = await supabase.from('email_flow_recipients').insert(rows);
      if (rErr) throw rErr;
      toast.success(`Disparo criado com ${selected.size} destinatários. Configure o e-mail na aba Fluxos.`);
      setSelected(new Set());
      setFlows((prev) => [{ id: flow.id, name: flow.name }, ...prev]);
    } catch (e) {
      toast.error('Erro ao salvar', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const attachToExisting = async () => {
    if (!targetFlow || selected.size === 0) return;
    try {
      const rows = Array.from(selected).map((lead_id) => ({ flow_id: targetFlow, lead_id, status: 'pending' }));
      const { error } = await supabase.from('email_flow_recipients').upsert(rows, { onConflict: 'flow_id,lead_id' });
      if (error) throw error;
      toast.success(`${selected.size} leads adicionados ao disparo.`);
      setSelected(new Set());
    } catch (e) {
      toast.error('Erro', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Enfileira os envios em vez de disparar um a um pelo navegador.
   * O processador em segundo plano (process-email-flows, cron 1 min) processa a fila.
   * O botão retorna imediatamente após enfileirar — não trava a UI e resiste a
   * fechamento de aba/queda de conexão.
   */
  const enqueueNow = async () => {
    if (!targetFlow || selected.size === 0 || !profile) return;
    setEnqueueing(true);
    try {
      const { data: steps, error: sErr } = await supabase.from('email_flow_steps')
        .select('id, subject, body_html').eq('flow_id', targetFlow).order('order_index').limit(1);
      if (sErr) throw sErr;
      const step = steps?.[0];
      if (!step || !step.subject || !step.body_html) {
        toast.error('Configure o e-mail do disparo antes de enviar.');
        return;
      }

      const targets = leads.filter((l) => selected.has(l.id) && l.email);
      if (targets.length === 0) { toast.error('Nenhum destinatário com e-mail válido.'); return; }

      // 1) Garante recipient row por lead
      const recipientRows = targets.map((l) => ({ flow_id: targetFlow, lead_id: l.id, status: 'pending' as const }));
      await supabase.from('email_flow_recipients').upsert(recipientRows, { onConflict: 'flow_id,lead_id' });
      const { data: recData } = await supabase.from('email_flow_recipients')
        .select('id, lead_id').eq('flow_id', targetFlow)
        .in('lead_id', targets.map((t) => t.id));
      const recMap = new Map((recData ?? []).map((r) => [r.lead_id, r.id]));

      // 2) Enfileira email_sends com status=pending e scheduled_for=now()
      const nowIso = new Date().toISOString();
      const sendRows = targets.map((l) => ({
        flow_id: targetFlow,
        flow_step_id: step.id,
        recipient_id: recMap.get(l.id) ?? null,
        lead_id: l.id,
        sdr_id: profile.id,
        to_email: l.email!,
        subject: step.subject,
        body_html: step.body_html,
        status: 'pending' as const,
        scheduled_for: nowIso,
      }));
      const { error: qErr } = await supabase.from('email_sends').insert(sendRows);
      if (qErr) throw qErr;

      toast.success(`${targets.length} e-mails enfileirados. O processador envia em segundo plano (até 1 min).`);
      setSelected(new Set());
    } catch (e) {
      toast.error('Erro ao enfileirar', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnqueueing(false);
    }
  };

  if (loading && leads.length === 0) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Filtrar leads</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Buscar por nome, e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <Checkbox checked={onlyWithEmail} onCheckedChange={(v) => setOnlyWithEmail(!!v)} />
            Apenas com e-mail
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {selected.size} selecionados de {filtered.length} exibidos
            {total > filtered.length && ` (de ${total} total — refine os filtros)`}
          </CardTitle>
          <div className="flex gap-2 items-center flex-wrap">
            <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={saveAsList}>
              <Save className="h-4 w-4 mr-2" />Salvar como disparo
            </Button>
            <div className="flex items-center gap-1">
              <Select value={targetFlow} onValueChange={setTargetFlow}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Disparo existente" /></SelectTrigger>
                <SelectContent>
                  {flows.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={!targetFlow || selected.size === 0} onClick={attachToExisting}>Adicionar</Button>
              <Button size="sm" disabled={!targetFlow || selected.size === 0 || enqueueing} onClick={enqueueNow}>
                {enqueueing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enfileirar envio
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="max-h-[500px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size > 0 && selected.size === filtered.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Cidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id} className={selected.has(l.id) ? 'bg-primary/5' : ''}>
                  <TableCell><Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} /></TableCell>
                  <TableCell className="font-medium">{l.nome_fantasia || l.razao_social}</TableCell>
                  <TableCell className="text-muted-foreground">{l.email || '—'}</TableCell>
                  <TableCell>{l.status || '—'}</TableCell>
                  <TableCell>{l.fonte || '—'}</TableCell>
                  <TableCell>{l.cidade || '—'}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhum lead corresponde aos filtros.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disparos criados</CardTitle>
        </CardHeader>
        <CardContent>
          <FlowManager type="blast" />
        </CardContent>
      </Card>
    </div>
  );
}
