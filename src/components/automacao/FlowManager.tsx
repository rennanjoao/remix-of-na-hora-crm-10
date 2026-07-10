import { useEffect, useState, useCallback, useRef } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Play, Pause, CheckCircle2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BlockEditor } from './BlockEditor';
import { EmailBlock, blocksToHtml, defaultBlockFor } from '@/lib/email-blocks';

interface Flow {
  id: string;
  name: string;
  description: string | null;
  type: 'cadence' | 'blast';
  status: string;
  slug: string | null;
  created_at: string;
}

interface Step {
  id: string;
  flow_id: string;
  order_index: number;
  name: string | null;
  subject: string;
  body_html: string;
  blocks: EmailBlock[];
  delay_days: number;
}

interface Props {
  type: 'cadence' | 'blast';
}

const sanitize = (html: string) => DOMPurify.sanitize(html, {
  FORBID_TAGS: ['script', 'iframe', 'style', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
});

function stepIsFunctional(step: Step | undefined): boolean {
  if (!step) return false;
  if (!step.subject.trim()) return false;
  const plain = (step.body_html || '').replace(/<[^>]+>/g, '').trim();
  return plain.length > 0;
}

async function flowRecipientCount(flowId: string): Promise<number> {
  const { count } = await supabase
    .from('email_flow_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('flow_id', flowId);
  return count ?? 0;
}

export function FlowManager({ type }: Props) {
  const { profile } = useAuth();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFlow, setNewFlow] = useState({ name: '', description: '' });
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [editingStep, setEditingStep] = useState<Step | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dirty, setDirty] = useState(false);
  const autosaveRef = useRef<number | null>(null);

  const fetchFlows = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('email_flows')
        .select('*')
        .eq('type', type)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFlows((data ?? []) as Flow[]);
    } catch (e) {
      toast.error('Erro ao carregar', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  const createFlow = async () => {
    if (!profile || !newFlow.name.trim()) return;
    try {
      const { data, error } = await supabase.from('email_flows').insert({
        name: newFlow.name,
        description: newFlow.description || null,
        type,
        created_by: profile.id,
      }).select().single();
      if (error) throw error;
      toast.success('Criado!');
      setCreateOpen(false);
      setNewFlow({ name: '', description: '' });
      fetchFlows();
      openFlow(data as Flow);
    } catch (e) {
      toast.error('Erro ao criar', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const openFlow = async (flow: Flow) => {
    setSelectedFlow(flow);
    try {
      const { data, error } = await supabase
        .from('email_flow_steps')
        .select('*')
        .eq('flow_id', flow.id)
        .order('order_index');
      if (error) throw error;
      const parsed = (data ?? []).map((s) => ({
        ...s,
        blocks: (s.blocks as unknown as EmailBlock[]) ?? [],
      })) as Step[];
      setSteps(parsed);
    } catch (e) {
      toast.error('Erro ao abrir', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const addStep = async () => {
    if (!selectedFlow) return;
    try {
      const initial = [defaultBlockFor('text')];
      const { data, error } = await supabase.from('email_flow_steps').insert({
        flow_id: selectedFlow.id,
        order_index: steps.length + 1,
        name: type === 'blast' ? 'Disparo' : `Passo ${steps.length + 1}`,
        subject: '',
        blocks: initial,
        body_html: blocksToHtml(initial),
        delay_days: 0,
      }).select().single();
      if (error) throw error;
      const newStep: Step = { ...(data), blocks: initial } as Step;
      setSteps((prev) => [...prev, newStep]);
      setEditingStep(newStep);
      setSaveState('saved');
      setDirty(false);
    } catch (e) {
      toast.error('Erro ao adicionar passo', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const persistStep = async (step: Step) => {
    setSaveState('saving');
    try {
      const { error } = await supabase.from('email_flow_steps').update({
        subject: step.subject,
        blocks: step.blocks as unknown as never,
        body_html: blocksToHtml(step.blocks),
        delay_days: step.delay_days,
      }).eq('id', step.id);
      if (error) throw error;
      setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...step, body_html: blocksToHtml(step.blocks) } : s)));
      setSaveState('saved');
      setDirty(false);
    } catch (e) {
      setSaveState('error');
      toast.error('Falha no autosave', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  // Debounced autosave whenever editingStep changes and is dirty
  useEffect(() => {
    if (!editingStep || !dirty) return;
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current);
    autosaveRef.current = window.setTimeout(() => {
      persistStep(editingStep);
    }, 1500);
    return () => {
      if (autosaveRef.current) window.clearTimeout(autosaveRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingStep, dirty]);

  // Warn when trying to close with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const deleteFlow = async (id: string) => {
    try {
      const { error } = await supabase.from('email_flows').delete().eq('id', id);
      if (error) throw error;
      setFlows((prev) => prev.filter((f) => f.id !== id));
      if (selectedFlow?.id === id) { setSelectedFlow(null); setSteps([]); }
      toast.success('Removido');
    } catch (e) {
      toast.error('Erro ao remover', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const toggleStatus = async (flow: Flow) => {
    if (flow.status !== 'ativa') {
      // Validate before activating
      const { data: stepsData } = await supabase.from('email_flow_steps')
        .select('subject, body_html').eq('flow_id', flow.id);
      const stepsList = (stepsData ?? []) as { subject: string; body_html: string }[];
      if (stepsList.length === 0) {
        toast.error('Não é possível ativar', { description: 'Adicione ao menos um passo com assunto e conteúdo.' });
        return;
      }
      const bad = stepsList.find((s) => !s.subject.trim() || (s.body_html || '').replace(/<[^>]+>/g, '').trim().length === 0);
      if (bad) {
        toast.error('Não é possível ativar', { description: 'Todos os passos precisam de assunto e conteúdo.' });
        return;
      }
      if (flow.type === 'blast' && !flow.slug) {
        const rc = await flowRecipientCount(flow.id);
        if (rc === 0) {
          toast.error('Não é possível ativar', { description: 'Adicione destinatários antes de ativar o disparo.' });
          return;
        }
      }
    }
    const next = flow.status === 'ativa' ? 'pausada' : 'ativa';
    try {
      const { error } = await supabase.from('email_flows').update({ status: next }).eq('id', flow.id);
      if (error) throw error;
      setFlows((prev) => prev.map((f) => (f.id === flow.id ? { ...f, status: next } : f)));
      toast.success(next === 'ativa' ? 'Fluxo ativo — envios serão processados pelo motor de agendamento' : 'Fluxo pausado');
    } catch (e) {
      toast.error('Erro', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const statusBadge = (f: Flow) => {
    const map: Record<string, { label: string; className: string }> = {
      rascunho: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
      ativa: { label: 'Ativa', className: 'bg-success text-success-foreground' },
      pausada: { label: 'Pausada', className: 'bg-secondary text-secondary-foreground' },
      concluida: { label: 'Concluída', className: 'bg-primary/20 text-primary' },
    };
    const v = map[f.status] ?? map.rascunho;
    return <Badge className={v.className}>{v.label}</Badge>;
  };

  const functionalBadge = (functional: boolean) => (
    functional
      ? <Badge variant="outline" className="text-xs gap-1 border-success/40 text-success"><CheckCircle2 className="h-3 w-3" />Pronto para envio</Badge>
      : <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700"><AlertCircle className="h-3 w-3" />Sem conteúdo ou assunto</Badge>
  );

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {type === 'cadence' ? 'Fluxos de cadência com múltiplos passos.' : 'Disparos únicos para listas de leads.'}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Novo {type === 'cadence' ? 'Fluxo' : 'Disparo'}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {flows.map((f) => (
          <Card key={f.id} className={`cursor-pointer hover:border-primary/50 ${selectedFlow?.id === f.id ? 'border-primary' : ''}`} onClick={() => openFlow(f)}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start gap-2">
                <CardTitle className="text-base">{f.name}</CardTitle>
                {statusBadge(f)}
              </div>
              <CardDescription className="line-clamp-2">
                {f.description || (f.slug ? `Gatilho: ${f.slug}` : 'Sem descrição')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-between items-center pt-0">
              <p className="text-xs text-muted-foreground">{format(new Date(f.created_at), 'dd/MM/yy', { locale: ptBR })}</p>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); toggleStatus(f); }} title={f.status === 'ativa' ? 'Pausar' : 'Ativar'}>
                  {f.status === 'ativa' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteFlow(f.id); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {flows.length === 0 && (
          <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
            Nenhum {type === 'cadence' ? 'fluxo' : 'disparo'} criado.
          </div>
        )}
      </div>

      {selectedFlow && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center gap-3 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {selectedFlow.name}
                  {functionalBadge(steps.length > 0 && steps.every(stepIsFunctional))}
                </CardTitle>
                <CardDescription>
                  {type === 'cadence' ? 'Configure os passos do fluxo' : 'Configure o e-mail do disparo'}
                  {selectedFlow.slug && ` · gatilho: ${selectedFlow.slug}`}
                </CardDescription>
              </div>
              {type === 'cadence' && (
                <Button size="sm" onClick={addStep}><Plus className="h-4 w-4 mr-1" />Adicionar passo</Button>
              )}
              {type === 'blast' && steps.length === 0 && (
                <Button size="sm" onClick={addStep}><Plus className="h-4 w-4 mr-1" />Configurar e-mail</Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem passos configurados.</p>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {steps.map((step) => (
                  <AccordionItem key={step.id} value={step.id}>
                    <AccordionTrigger>
                      <div className="flex items-center gap-3 text-left w-full pr-2">
                        <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-sm flex items-center justify-center font-bold">
                          {step.order_index}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{step.subject || '(sem assunto)'}</p>
                          <p className="text-xs text-muted-foreground">
                            {step.delay_days > 0 ? `Aguardar ${step.delay_days} dia(s)` : 'Enviar imediatamente'}
                          </p>
                        </div>
                        {functionalBadge(stepIsFunctional(step))}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex justify-end gap-2 mb-2">
                        <Button size="sm" variant="outline" onClick={() => { setEditingStep(step); setDirty(false); setSaveState('idle'); }}>Editar</Button>
                      </div>
                      <div className="rounded-md border p-4 bg-white" dangerouslySetInnerHTML={{ __html: sanitize(step.body_html) }} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo {type === 'cadence' ? 'Fluxo' : 'Disparo'}</DialogTitle>
            <DialogDescription>Dê um nome e uma breve descrição.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Nome</Label><Input value={newFlow.name} onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })} /></div>
            <div><Label>Descrição</Label><Textarea value={newFlow.description} onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })} /></div>
            <Button className="w-full" onClick={createFlow} disabled={!newFlow.name.trim()}>Criar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Step editor */}
      <Dialog open={!!editingStep} onOpenChange={(o) => {
        if (!o) {
          if (dirty && editingStep) {
            // flush pending autosave
            persistStep(editingStep);
          }
          setEditingStep(null);
        }
      }}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editor de e-mail</DialogTitle>
            <DialogDescription>Arraste blocos, edite inline, use variáveis e envie um teste antes de ativar. Autosave em ~1,5s.</DialogDescription>
          </DialogHeader>
          {editingStep && (
            <>
              <BlockEditor
                blocks={editingStep.blocks}
                subject={editingStep.subject}
                saveState={saveState}
                dirty={dirty}
                onChange={(blocks) => { setEditingStep({ ...editingStep, blocks }); setDirty(true); setSaveState('idle'); }}
                onSubjectChange={(subject) => { setEditingStep({ ...editingStep, subject }); setDirty(true); setSaveState('idle'); }}
              />
              <div className="flex justify-between items-center mt-4">
                <div className="flex items-center gap-2">
                  <Label>Delay (dias)</Label>
                  <Input
                    type="number"
                    min={0}
                    className="w-24"
                    value={editingStep.delay_days}
                    onChange={(e) => { setEditingStep({ ...editingStep, delay_days: parseInt(e.target.value) || 0 }); setDirty(true); }}
                  />
                </div>
                <Button onClick={() => persistStep(editingStep)} disabled={saveState === 'saving'}>
                  {saveState === 'saving' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Salvar agora
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
