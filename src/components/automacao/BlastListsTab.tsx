import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Send, Save } from 'lucide-react';
import { FlowManager } from './FlowManager';

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

export function BlastListsTab() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [fonte, setFonte] = useState<string>('all');
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);

  // Attach recipients
  const [flows, setFlows] = useState<BlastFlow[]>([]);
  const [targetFlow, setTargetFlow] = useState<string>('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [leadsRes, flowsRes] = await Promise.all([
          supabase.from('leads').select('id, razao_social, nome_fantasia, email, status, fonte, cidade'),
          supabase.from('email_flows').select('id, name').eq('type', 'blast').order('created_at', { ascending: false }),
        ]);
        if (leadsRes.error) throw leadsRes.error;
        if (flowsRes.error) throw flowsRes.error;
        setLeads((leadsRes.data ?? []) as Lead[]);
        setFlows((flowsRes.data ?? []) as BlastFlow[]);
      } catch (e) {
        toast.error('Erro ao carregar', { description: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => leads.filter((l) => {
    if (onlyWithEmail && !l.email) return false;
    if (status !== 'all' && l.status !== status) return false;
    if (fonte !== 'all' && l.fonte !== fonte) return false;
    if (search) {
      const s = search.toLowerCase();
      const hit = (l.razao_social ?? '').toLowerCase().includes(s)
        || (l.nome_fantasia ?? '').toLowerCase().includes(s)
        || (l.email ?? '').toLowerCase().includes(s);
      if (!hit) return false;
    }
    return true;
  }), [leads, onlyWithEmail, status, fonte, search]);

  const statuses = useMemo(() => Array.from(new Set(leads.map((l) => l.status).filter(Boolean))) as string[], [leads]);
  const fontes = useMemo(() => Array.from(new Set(leads.map((l) => l.fonte).filter(Boolean))) as string[], [leads]);

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

  const sendNow = async () => {
    if (!targetFlow || selected.size === 0 || !profile) return;
    setSending(true);
    try {
      // Fetch step to send
      const { data: steps, error: sErr } = await supabase.from('email_flow_steps')
        .select('id, subject, body_html').eq('flow_id', targetFlow).order('order_index').limit(1);
      if (sErr) throw sErr;
      const step = steps?.[0];
      if (!step || !step.subject) {
        toast.error('Configure o e-mail do disparo antes de enviar.');
        return;
      }
      const targets = leads.filter((l) => selected.has(l.id) && l.email);
      let ok = 0, fail = 0;
      for (const lead of targets) {
        try {
          const { error } = await supabase.functions.invoke('send-email', {
            body: {
              lead_id: lead.id,
              sdr_id: profile.id,
              to_email: lead.email,
              subject: step.subject,
              body_html: step.body_html,
            },
          });
          if (error) throw error;
          ok++;
        } catch { fail++; }
      }
      toast.success(`Enviados: ${ok}${fail ? ` · Falhas: ${fail}` : ''}`);
      setSelected(new Set());
    } catch (e) {
      toast.error('Erro ao enviar', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

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
          <Select value={fonte} onValueChange={setFonte}>
            <SelectTrigger><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {fontes.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyWithEmail} onCheckedChange={(v) => setOnlyWithEmail(!!v)} />
            Apenas com e-mail
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{selected.size} selecionados de {filtered.length}</CardTitle>
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
              <Button size="sm" disabled={!targetFlow || selected.size === 0 || sending} onClick={sendNow}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar agora
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
