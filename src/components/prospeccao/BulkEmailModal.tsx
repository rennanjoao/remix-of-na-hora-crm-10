import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Send, Save, Mail, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { logLeadActivity } from '@/lib/lead-activities';
import { FacadeImageGrid, type FacadeItem } from './FacadeImageGrid';

interface Template {
  id: string;
  subject: string;
  body_html: string;
  flow_name: string;
}

export interface BulkEmailTarget {
  place_id: string;
  display_name: string | null;
  email: string | null;
  email_confidence?: 'high' | 'medium' | 'manual' | null;
  website?: string | null;
  lead_id: string | null;
  photo_name?: string | null;
  fallback_url?: string | null;
}

function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return null; }
}
const CONFIDENCE_RANK: Record<string, number> = { manual: 3, high: 2, medium: 1 };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: BulkEmailTarget[];
  onEnsureLead: (place_id: string) => Promise<string | null>;
}

export function BulkEmailModal({ open, onOpenChange, targets, onEnsureLead }: Props) {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [listName, setListName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [includeMedium, setIncludeMedium] = useState(false);
  const [mxChecking, setMxChecking] = useState(false);
  const [mxResults, setMxResults] = useState<Map<string, boolean>>(new Map());
  const [mxChecked, setMxChecked] = useState(false);

  const withEmailRaw = useMemo(() => targets.filter(t => !!t.email), [targets]);
  const withoutEmail = targets.length - withEmailRaw.length;

  // 1) Confidence gate — "média" confiança fica de fora por padrão (endereço
  //    achado por regex solta no HTML, não em mailto: ou contato direto).
  const byConfidence = useMemo(
    () => withEmailRaw.filter(t => t.email_confidence !== 'medium' || includeMedium),
    [withEmailRaw, includeMedium],
  );
  const skippedByConfidence = withEmailRaw.length - byConfidence.length;

  // 2) Domain dedup — duas empresas (ou duas filiais) no mesmo domínio só
  //    disparam uma vez, ficando com o e-mail de maior confiança.
  const { list: byDomain, duplicates: skippedByDomain } = useMemo(() => {
    const bestPerDomain = new Map<string, BulkEmailTarget>();
    const noDomain: BulkEmailTarget[] = [];
    for (const t of byConfidence) {
      const d = domainOf(t.website);
      if (!d) { noDomain.push(t); continue; }
      const current = bestPerDomain.get(d);
      const rank = CONFIDENCE_RANK[t.email_confidence ?? 'high'] ?? 2;
      const currentRank = current ? (CONFIDENCE_RANK[current.email_confidence ?? 'high'] ?? 2) : -1;
      if (!current || rank > currentRank) bestPerDomain.set(d, t);
    }
    const list = [...noDomain, ...bestPerDomain.values()];
    return { list, duplicates: byConfidence.length - list.length };
  }, [byConfidence]);

  const eligible = byDomain;

  const runMxCheck = async (list: BulkEmailTarget[]): Promise<Map<string, boolean>> => {
    const emails = list.map(t => t.email!).filter(Boolean);
    if (emails.length === 0) return new Map();
    try {
      const { data, error } = await supabase.functions.invoke('verify-email-mx', { body: { emails } });
      if (error) throw error;
      return new Map(Object.entries((data?.results ?? {}) as Record<string, boolean>));
    } catch (e) {
      console.error('verify-email-mx', e);
      toast.error('Não foi possível verificar os domínios de e-mail agora', { description: e instanceof Error ? e.message : undefined });
      return new Map();
    }
  };

  const handleVerify = async () => {
    if (eligible.length === 0) { toast.info('Nada elegível para verificar'); return; }
    setMxChecking(true);
    const result = await runMxCheck(eligible);
    setMxResults(result);
    setMxChecked(true);
    setMxChecking(false);
    const invalid = eligible.filter(t => {
      const d = domainOf(t.website ?? t.email?.split('@')[1] ?? null);
      return d && result.get(d) === false;
    }).length;
    if (invalid > 0) toast.warning(`${invalid} domínio(s) sem servidor de e-mail válido — serão ignorados no disparo`);
    else toast.success('Todos os domínios verificados têm servidor de e-mail válido');
  };

  // Final sendable list: eligible ∩ MX-valid (only enforced after a check has run)
  const withEmail = useMemo(() => {
    if (!mxChecked) return eligible;
    return eligible.filter(t => {
      const d = domainOf(t.website) ?? t.email?.split('@')[1]?.toLowerCase() ?? null;
      if (!d) return true;
      const v = mxResults.get(d);
      return v !== false; // undefined (not checked) or true passes
    });
  }, [eligible, mxChecked, mxResults]);

  const facadeItems: FacadeItem[] = useMemo(
    () => targets.map(t => ({
      place_id: t.place_id,
      display_name: t.display_name,
      photo_name: t.photo_name,
      fallback_url: t.fallback_url,
    })),
    [targets],
  );

  useEffect(() => {
    if (!open) return;
    setMxChecked(false);
    setMxResults(new Map());
    (async () => {
      setLoading(true);
      const { data: flows } = await supabase
        .from('email_flows')
        .select('id, name')
        .eq('type', 'cadence')
        .eq('status', 'ativa');
      if (!flows) { setLoading(false); return; }
      const ids = flows.map((f) => f.id);
      if (ids.length === 0) { setTemplates([]); setLoading(false); return; }
      const { data: steps } = await supabase.from('email_flow_steps')
        .select('id, subject, body_html, flow_id, order_index')
        .in('flow_id', ids)
        .order('order_index');
      const byFlow = new Map(flows.map((f) => [f.id, f.name]));
      const list: Template[] = (steps ?? []).map((s) => ({
        id: s.id,
        subject: s.subject,
        body_html: s.body_html,
        flow_name: `${byFlow.get(s.flow_id) ?? '—'} · Passo ${s.order_index}`,
      }));
      setTemplates(list);
      setLoading(false);
    })();
    setListName(`Disparo ${new Date().toLocaleDateString('pt-BR')}`);
  }, [open]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (t) { setSubject(t.subject); setBodyHtml(t.body_html); }
  };

  /** Creates a blast flow + single step + recipients. Returns flow id or null. */
  const saveList = async (): Promise<{ flowId: string; stepId: string } | null> => {
    if (!profile) return null;
    const leadIds: string[] = [];
    for (const t of withEmail) {
      let id = t.lead_id;
      if (!id) id = await onEnsureLead(t.place_id);
      if (id) leadIds.push(id);
    }
    const { data: flow, error: fErr } = await supabase.from('email_flows')
      .insert({
        name: listName || 'Disparo sem nome',
        type: 'blast',
        status: 'rascunho',
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (fErr || !flow) { toast.error('Falha ao salvar disparo'); console.error(fErr); return null; }

    const { data: step, error: sErr } = await supabase.from('email_flow_steps')
      .insert({
        flow_id: flow.id,
        order_index: 1,
        name: 'Disparo',
        subject,
        blocks: [],
        body_html: bodyHtml,
        delay_days: 0,
      })
      .select('id')
      .single();
    if (sErr || !step) { toast.error('Falha ao salvar passo'); console.error(sErr); return null; }

    if (leadIds.length > 0) {
      const rows = leadIds.map((lead_id) => ({ flow_id: flow.id, lead_id, status: 'pending' }));
      await supabase.from('email_flow_recipients').insert(rows);
    }
    return { flowId: flow.id, stepId: step.id };
  };

  const handleSaveOnly = async () => {
    if (!subject || !bodyHtml) { toast.error('Assunto e corpo obrigatórios'); return; }
    setSending(true);
    const res = await saveList();
    setSending(false);
    if (res) { toast.success('Disparo salvo'); onOpenChange(false); }
  };

  const handleSend = async () => {
    if (!profile) return;
    if (!subject || !bodyHtml) { toast.error('Assunto e corpo obrigatórios'); return; }
    if (eligible.length === 0) { toast.error('Nenhum lead elegível (e-mail + confiança + domínio único)'); return; }
    setSending(true);
    setMxChecking(true);
    const mx = await runMxCheck(eligible);
    setMxResults(mx); setMxChecked(true); setMxChecking(false);
    const sendable = eligible.filter(t => {
      const d = domainOf(t.website) ?? t.email?.split('@')[1]?.toLowerCase() ?? null;
      if (!d) return true;
      return mx.get(d) !== false; // undefined (couldn't check) or true → allow
    });
    const skippedMx = eligible.length - sendable.length;
    if (sendable.length === 0) {
      toast.error('Nenhum e-mail passou na verificação de domínio (MX)');
      setSending(false);
      return;
    }
    const saved = await saveList();
    if (!saved) { setSending(false); return; }
    setProgress({ done: 0, total: sendable.length });
    let ok = 0, err = 0;
    for (let i = 0; i < sendable.length; i++) {
      const t = sendable[i];
      const leadId = t.lead_id ?? await onEnsureLead(t.place_id);
      if (!leadId || !t.email) { err++; setProgress({ done: i + 1, total: sendable.length }); continue; }
      try {
        const { error } = await supabase.functions.invoke('send-email', {
          body: {
            lead_id: leadId,
            sdr_id: profile.id,
            to_email: t.email,
            subject,
            body_html: bodyHtml,
            flow_id: saved.flowId,
            flow_step_id: saved.stepId,
          },
        });
        if (error) throw error;
        ok++;
        await logLeadActivity({
          leadId,
          userId: profile.id,
          actionType: 'email_sent',
          description: `E-mail em massa: ${subject}`,
          metadata: { flow_id: saved.flowId, to: t.email },
        });
      } catch (e) {
        console.error('bulk-send', e); err++;
      }
      setProgress({ done: i + 1, total: sendable.length });
    }
    await supabase.from('email_flows')
      .update({ status: 'concluida' })
      .eq('id', saved.flowId);
    setSending(false); setProgress(null);
    toast.success(`Disparo concluído: ${ok} enviados, ${err} falhas${skippedMx > 0 ? `, ${skippedMx} ignorados (domínio sem e-mail válido)` : ''}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Disparo de e-mail em massa
          </DialogTitle>
          <DialogDescription>
            {targets.length} leads selecionados · <Badge variant="secondary">{eligible.length} elegíveis</Badge>
            {withoutEmail > 0 && <> · <Badge variant="outline">{withoutEmail} sem e-mail</Badge></>}
            {skippedByConfidence > 0 && <> · <Badge variant="outline">{skippedByConfidence} confiança baixa</Badge></>}
            {skippedByDomain > 0 && <> · <Badge variant="outline">{skippedByDomain} domínio duplicado</Badge></>}
          </DialogDescription>
        </DialogHeader>

        {targets.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Prévia visual das empresas</Label>
            <FacadeImageGrid items={facadeItems} />
          </div>
        )}

        <div className="rounded-md border border-border p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Checkbox id="include-medium" checked={includeMedium} onCheckedChange={(v) => { setIncludeMedium(!!v); setMxChecked(false); }} />
            <Label htmlFor="include-medium" className="text-xs font-normal cursor-pointer">
              Incluir e-mails de confiança média (achados soltos no site — revise antes de confiar)
            </Label>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={handleVerify} disabled={mxChecking || eligible.length === 0}>
              {mxChecking ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1" />}
              Verificar domínios (MX)
            </Button>
            {mxChecked && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                {withEmail.length === eligible.length ? (
                  <><ShieldCheck className="h-3.5 w-3.5 text-green-600" />todos os domínios válidos</>
                ) : (
                  <><ShieldAlert className="h-3.5 w-3.5 text-amber-600" />{eligible.length - withEmail.length} domínio(s) inválido(s) serão ignorados</>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={applyTemplate} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? 'Carregando…' : templates.length === 0 ? 'Nenhum template ativo — preencha manualmente' : 'Escolher template'} />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.flow_name} — {t.subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nome do disparo (interno)</Label>
            <Input value={listName} onChange={(e) => setListName(e.target.value)} />
          </div>
          <div>
            <Label>Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail" />
          </div>
          <div>
            <Label>Corpo (HTML) — use {'{{lead.nome}}'}, {'{{lead.empresa}}'}, {'{{lead.cidade}}'}</Label>
            <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={10} placeholder="<p>Olá {{lead.nome}}, ...</p>" />
          </div>
        </div>

        {progress && (
          <div className="text-xs text-muted-foreground">
            Enviando {progress.done} de {progress.total}…
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleSaveOnly} disabled={sending}>
            <Save className="h-4 w-4 mr-1" /> Salvar rascunho
          </Button>
          <Button onClick={handleSend} disabled={sending || eligible.length === 0}>
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Disparar para {mxChecked ? withEmail.length : eligible.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
