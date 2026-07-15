import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Phone, MessageCircle, Mail, Video, StickyNote, X, ArrowRight,
  Inbox, Clock, AlertCircle, Sparkles, RefreshCw, Loader2, MapPin,
  Building2, Zap,
} from 'lucide-react';
import { LeadActivityTimeline } from '@/components/leads/LeadActivityTimeline';
import { LeadRichProfile } from '@/components/prospeccao/LeadRichProfile';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';
import { logLeadActivity } from '@/lib/lead-activities';
import { getDefaultScript, interpolateScript } from '@/lib/approach-scripts';
import { cn } from '@/lib/utils';

interface QueueItem {
  item_key: string;
  source: string;
  bucket: string;
  priority: number;
  lead_id: string;
  lead_name: string;
  lead_city: string | null;
  lead_state: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  lead_status: string;
  title: string;
  due_at: string | null;
  extra: Record<string, unknown>;
}

const BUCKET_META: Record<string, { label: string; icon: typeof Inbox; className: string }> = {
  responses: { label: 'Respostas', icon: Inbox, className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  now: { label: 'Agora', icon: Zap, className: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30' },
  overdue: { label: 'Atrasados', icon: AlertCircle, className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  today: { label: 'Hoje', icon: Clock, className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  new: { label: 'Novos', icon: Sparkles, className: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  reactivation: { label: 'Reativação', icon: RefreshCw, className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
};
const BUCKET_ORDER = ['responses', 'now', 'overdue', 'today', 'new', 'reactivation'];

function normalizePhone(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

export default function Foco() {
  const { profile } = useAuth();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [callResult, setCallResult] = useState<'atendeu' | 'nao_atendeu' | 'caixa' | ''>('');
  const [nextDate, setNextDate] = useState('');
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [pullingLead, setPullingLead] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('sdr_work_queue' as never);
    if (error) toast.error('Erro ao carregar fila', { description: error.message });
    setItems(((data as unknown) as QueueItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeKey && items.length) setActiveKey(items[0].item_key);
  }, [items, activeKey]);

  const active = useMemo(() => items.find(i => i.item_key === activeKey) || null, [items, activeKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const it of items) {
      if (!map.has(it.bucket)) map.set(it.bucket, []);
      map.get(it.bucket)!.push(it);
    }
    return BUCKET_ORDER.filter(b => map.has(b)).map(b => ({ bucket: b, items: map.get(b)! }));
  }, [items]);

  const advance = useCallback(() => {
    if (!items.length) return;
    const idx = items.findIndex(i => i.item_key === activeKey);
    const next = items[(idx + 1) % items.length];
    setActiveKey(next?.item_key ?? null);
    setNoteOpen(false); setCallResult(''); setNextDate(''); setNoteText('');
  }, [items, activeKey]);

  const navigate = useCallback((dir: 1 | -1) => {
    if (!items.length) return;
    const idx = items.findIndex(i => i.item_key === activeKey);
    const nextIdx = (idx + dir + items.length) % items.length;
    setActiveKey(items[nextIdx].item_key);
  }, [items, activeKey]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (!active) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); navigate(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); navigate(-1); }
      else if (e.key === 'c') { e.preventDefault(); doCall(); }
      else if (e.key === 'w') { e.preventDefault(); void doWhatsApp(); }
      else if (e.key === 'm') { e.preventDefault(); setMeetingOpen(true); }
      else if (e.key === 'n') { e.preventDefault(); setNoteOpen(true); }
      else if (e.key === 'd') { e.preventDefault(); void doDiscard(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); advance(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, navigate, advance]);

  const doCall = () => {
    if (!active?.lead_phone) { toast.error('Sem telefone cadastrado'); return; }
    window.open(`tel:${normalizePhone(active.lead_phone)}`);
    setCallResult('atendeu');
  };

  const doWhatsApp = async () => {
    if (!active) return;
    const phone = normalizePhone(active.lead_phone);
    if (!phone) { toast.error('Sem telefone cadastrado'); return; }
    let body: string;
    try {
      const script = await getDefaultScript('whatsapp');
      body = script ? interpolateScript(script.body, {
        nome: active.lead_name, cidade: active.lead_city || '', segmento: '',
      }) : `Olá! Somos especializados em soluções de transporte. Podemos falar sobre a ${active.lead_name}?`;
    } catch {
      body = `Olá! Somos especializados em soluções de transporte. Podemos falar sobre a ${active.lead_name}?`;
    }
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(body)}`, '_blank');
    if (profile) {
      await logLeadActivity({
        leadId: active.lead_id, userId: profile.id,
        actionType: 'whatsapp_sent', description: 'WhatsApp enviado',
      });
    }
  };

  const doDiscard = async () => {
    if (!active || !profile) return;
    if (!confirm('Descartar este lead?')) return;
    await supabase.from('leads').update({ status: 'perdido', is_suppressed: true } as never).eq('id', active.lead_id);
    await logLeadActivity({
      leadId: active.lead_id, userId: profile.id,
      actionType: 'status_change', description: 'Lead descartado pela fila',
      newStatus: 'perdido',
    });
    toast.success('Lead descartado');
    setItems(prev => prev.filter(i => i.item_key !== active.item_key));
    advance();
  };

  const submitCallResult = async () => {
    if (!active || !profile || !callResult) return;
    const map = { atendeu: 'Ligação atendida', nao_atendeu: 'Ligação sem resposta', caixa: 'Caiu na caixa postal' };
    await logLeadActivity({
      leadId: active.lead_id, userId: profile.id,
      actionType: 'call_made', description: map[callResult],
    });
    if (nextDate) {
      await supabase.from('tasks').insert({
        assigned_to: profile.id, created_by: profile.id, lead_id: active.lead_id,
        title: `Follow-up com ${active.lead_name}`,
        start_time: new Date(nextDate).toISOString(), completed: false,
      } as never);
    }
    toast.success('Registro salvo');
    setCallResult(''); setNextDate('');
    void load();
  };

  const submitNote = async () => {
    if (!active || !profile || !noteText.trim()) return;
    await logLeadActivity({
      leadId: active.lead_id, userId: profile.id,
      actionType: 'note_added', description: noteText.trim(),
    });
    await supabase.from('lead_timeline').insert({
      lead_id: active.lead_id, author_id: profile.id, content: noteText.trim(),
    } as never);
    toast.success('Nota salva');
    setNoteText(''); setNoteOpen(false);
  };

  const pullNextLead = async () => {
    setPullingLead(true);
    try {
      const { data, error } = await supabase.rpc('claim_next_lead' as never);
      if (error) throw error;
      if (!data) { toast.info('Não há leads novos na fila global'); return; }
      toast.success('Novo lead atribuído a você');
      void load();
    } catch (e) {
      toast.error('Erro ao puxar lead', { description: e instanceof Error ? e.message : '' });
    } finally { setPullingLead(false); }
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-7rem)] gap-4">
        {/* FILA */}
        <div className="w-72 shrink-0 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="font-display text-xl font-bold flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" /> Foco
              </h1>
              <p className="text-xs text-muted-foreground">{items.length} itens • ordem por prioridade</p>
            </div>
            <Button size="icon" variant="ghost" onClick={() => void load()} title="Atualizar">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
          <Button onClick={pullNextLead} disabled={pullingLead} size="sm" className="mb-3 w-full">
            {pullingLead ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Puxar novo lead
          </Button>
          <ScrollArea className="flex-1 -mr-2 pr-2" ref={listRef}>
            {loading && !items.length ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">
                Sem itens na fila.<br />Puxe um novo lead ou vá para a Prospecção.
              </div>
            ) : (
              grouped.map(({ bucket, items: bucketItems }) => {
                const meta = BUCKET_META[bucket];
                const Icon = meta?.icon || Inbox;
                return (
                  <div key={bucket} className="mb-4">
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-xs font-semibold uppercase tracking-wide">{meta?.label || bucket}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{bucketItems.length}</span>
                    </div>
                    <div className="space-y-1">
                      {bucketItems.map(it => (
                        <button
                          key={it.item_key}
                          onClick={() => setActiveKey(it.item_key)}
                          className={cn(
                            'w-full text-left rounded-md border p-2 transition-colors hover:bg-accent/40',
                            activeKey === it.item_key && 'bg-accent/60 border-primary',
                          )}
                        >
                          <div className="text-sm font-medium truncate">{it.lead_name}</div>
                          <div className="text-xs text-muted-foreground truncate">{it.title}</div>
                          {it.lead_city && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                              <MapPin className="h-2.5 w-2.5" />{it.lead_city}{it.lead_state ? `/${it.lead_state}` : ''}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* LEAD ATIVO */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Selecione um item da fila para começar.
            </div>
          ) : (
            <>
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-bold truncate flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                      {active.lead_name}
                    </h2>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                      {active.lead_city && <span>{active.lead_city}{active.lead_state ? `/${active.lead_state}` : ''}</span>}
                      {active.lead_phone && <span>• {active.lead_phone}</span>}
                      {active.lead_email && <span>• {active.lead_email}</span>}
                      <Badge variant="outline" className="text-[10px] py-0 h-4">{active.lead_status}</Badge>
                    </div>
                  </div>
                  <Badge className={cn('border', BUCKET_META[active.bucket]?.className)}>
                    {BUCKET_META[active.bucket]?.label || active.bucket}
                  </Badge>
                </div>
                <p className="text-sm mt-2 text-muted-foreground">{active.title}</p>
              </div>
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  <LeadRichProfile
                    cnpj=""
                    razaoSocial={active.lead_name}
                    nomeFantasia={active.lead_name}
                    municipio={active.lead_city}
                    uf={active.lead_state}
                  />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Histórico</h3>
                    <LeadActivityTimeline leadId={active.lead_id} />
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </Card>

        {/* AÇÕES */}
        <div className="w-72 shrink-0 flex flex-col gap-3">
          {active && (
            <>
              <Card className="p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Ações rápidas</div>
                <Button onClick={doCall} className="w-full justify-start" size="sm">
                  <Phone className="h-4 w-4 mr-2" /> Ligar <kbd className="ml-auto text-[10px] opacity-60">C</kbd>
                </Button>
                <Button onClick={() => void doWhatsApp()} variant="outline" className="w-full justify-start" size="sm">
                  <MessageCircle className="h-4 w-4 mr-2 text-green-600" /> WhatsApp <kbd className="ml-auto text-[10px] opacity-60">W</kbd>
                </Button>
                <Button
                  onClick={() => active.lead_email && window.open(`mailto:${active.lead_email}`)}
                  variant="outline" className="w-full justify-start" size="sm" disabled={!active.lead_email}>
                  <Mail className="h-4 w-4 mr-2" /> E-mail <kbd className="ml-auto text-[10px] opacity-60">E</kbd>
                </Button>
                <Button onClick={() => setMeetingOpen(true)} variant="outline" className="w-full justify-start" size="sm">
                  <Video className="h-4 w-4 mr-2" /> Agendar <kbd className="ml-auto text-[10px] opacity-60">M</kbd>
                </Button>
                <Button onClick={() => setNoteOpen(v => !v)} variant="outline" className="w-full justify-start" size="sm">
                  <StickyNote className="h-4 w-4 mr-2" /> Nota <kbd className="ml-auto text-[10px] opacity-60">N</kbd>
                </Button>
              </Card>

              {callResult && (
                <Card className="p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resultado da ligação</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['atendeu','nao_atendeu','caixa'] as const).map(r => (
                      <Button key={r} size="sm" variant={callResult === r ? 'default' : 'outline'}
                        onClick={() => setCallResult(r)} className="text-[11px] px-1 h-8">
                        {r === 'atendeu' ? 'Atendeu' : r === 'nao_atendeu' ? 'Sem resp.' : 'Caixa'}
                      </Button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Próximo contato</label>
                    <Input type="datetime-local" value={nextDate} onChange={e => setNextDate(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <Button size="sm" className="w-full" onClick={submitCallResult}>Salvar</Button>
                </Card>
              )}

              {noteOpen && (
                <Card className="p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nova nota</div>
                  <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="O que aconteceu?" rows={3} />
                  <Button size="sm" className="w-full" onClick={submitNote} disabled={!noteText.trim()}>Salvar nota</Button>
                </Card>
              )}

              <Card className="p-3 space-y-2">
                <Button onClick={advance} variant="secondary" className="w-full" size="sm">
                  <ArrowRight className="h-4 w-4 mr-2" /> Próximo <kbd className="ml-auto text-[10px] opacity-60">→</kbd>
                </Button>
                <Button onClick={() => void doDiscard()} variant="ghost" className="w-full text-destructive hover:text-destructive" size="sm">
                  <X className="h-4 w-4 mr-2" /> Descartar <kbd className="ml-auto text-[10px] opacity-60">D</kbd>
                </Button>
              </Card>

              <div className="text-[10px] text-muted-foreground px-1 mt-auto">
                Atalhos: J/K navegar • C ligar • W WhatsApp • E e-mail • M agendar • N nota • D descartar • → próximo
              </div>
            </>
          )}
        </div>
      </div>

      {meetingOpen && active && (
        <ScheduleMeetingModal
          open={meetingOpen}
          onOpenChange={setMeetingOpen}
          lead={{
            id: active.lead_id, razao_social: active.lead_name,
            nome_fantasia: null, email: active.lead_email, telefone: active.lead_phone,
          }}
          onMeetingCreated={() => { setMeetingOpen(false); void load(); }}
        />
      )}
    </DashboardLayout>
  );
}
