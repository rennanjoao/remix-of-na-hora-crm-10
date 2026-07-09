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
import { Loader2, Send, Save, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { logLeadActivity } from '@/lib/lead-activities';
import { FacadeImageGrid, type FacadeItem } from './FacadeImageGrid';

interface Template {
  id: string;
  subject: string;
  body_html: string;
  campaign_name: string;
}

export interface BulkEmailTarget {
  place_id: string;
  display_name: string | null;
  email: string | null;
  lead_id: string | null;
  photo_name?: string | null;
  fallback_url?: string | null;
}

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

  const withEmail = useMemo(() => targets.filter(t => !!t.email), [targets]);
  const withoutEmail = targets.length - withEmail.length;

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
    (async () => {
      setLoading(true);
      const { data: campaigns } = await supabase.from('email_campaigns').select('id, name').eq('status', 'ativa');
      if (!campaigns) { setLoading(false); return; }
      const ids = campaigns.map((c) => c.id);
      if (ids.length === 0) { setTemplates([]); setLoading(false); return; }
      const { data: steps } = await supabase.from('email_steps')
        .select('id, subject, body_html, campaign_id, step_order')
        .in('campaign_id', ids)
        .order('step_order');
      const byCamp = new Map(campaigns.map((c) => [c.id, c.name]));
      const list: Template[] = (steps ?? []).map((s) => ({
        id: s.id,
        subject: s.subject,
        body_html: s.body_html,
        campaign_name: `${byCamp.get(s.campaign_id) ?? '—'} · Passo ${s.step_order}`,
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

  const saveList = async (): Promise<string | null> => {
    if (!profile) return null;
    const leadIds: string[] = [];
    for (const t of withEmail) {
      let id = t.lead_id;
      if (!id) id = await onEnsureLead(t.place_id);
      if (id) leadIds.push(id);
    }
    const { data, error } = await supabase.from('email_blast_lists')
      .insert({
        name: listName || 'Disparo sem nome',
        subject,
        body_html: bodyHtml,
        template_step_id: templateId || null,
        lead_ids: leadIds,
        status: 'rascunho',
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (error) { toast.error('Falha ao salvar lista'); console.error(error); return null; }
    return data?.id ?? null;
  };

  const handleSaveOnly = async () => {
    if (!subject || !bodyHtml) { toast.error('Assunto e corpo obrigatórios'); return; }
    setSending(true);
    const id = await saveList();
    setSending(false);
    if (id) { toast.success('Lista de disparo salva'); onOpenChange(false); }
  };

  const handleSend = async () => {
    if (!profile) return;
    if (!subject || !bodyHtml) { toast.error('Assunto e corpo obrigatórios'); return; }
    if (withEmail.length === 0) { toast.error('Nenhum lead com e-mail'); return; }
    setSending(true);
    const listId = await saveList();
    setProgress({ done: 0, total: withEmail.length });
    let ok = 0, err = 0;
    for (let i = 0; i < withEmail.length; i++) {
      const t = withEmail[i];
      const leadId = t.lead_id ?? await onEnsureLead(t.place_id);
      if (!leadId || !t.email) { err++; setProgress({ done: i + 1, total: withEmail.length }); continue; }
      try {
        const { error } = await supabase.functions.invoke('send-email', {
          body: {
            lead_id: leadId,
            sdr_id: profile.id,
            to_email: t.email,
            subject,
            body_html: bodyHtml,
          },
        });
        if (error) throw error;
        ok++;
        await logLeadActivity({
          leadId,
          userId: profile.id,
          actionType: 'email_sent',
          description: `E-mail em massa: ${subject}`,
          metadata: { blast_list_id: listId, to: t.email },
        });
      } catch (e) {
        console.error('bulk-send', e); err++;
      }
      setProgress({ done: i + 1, total: withEmail.length });
    }
    if (listId) {
      await supabase.from('email_blast_lists')
        .update({ status: 'enviado', sent_count: ok, error_count: err })
        .eq('id', listId);
    }
    setSending(false); setProgress(null);
    toast.success(`Disparo concluído: ${ok} enviados, ${err} falhas`);
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
            {targets.length} leads selecionados · <Badge variant="secondary">{withEmail.length} com e-mail</Badge>
            {withoutEmail > 0 && <> · <Badge variant="outline">{withoutEmail} sem e-mail (ignorados)</Badge></>}
          </DialogDescription>
        </DialogHeader>

        {targets.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Prévia visual das empresas</Label>
            <FacadeImageGrid items={facadeItems} />
          </div>
        )}

        <div className="grid gap-3">
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={applyTemplate} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? 'Carregando…' : templates.length === 0 ? 'Nenhum template ativo — preencha manualmente' : 'Escolher template'} />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.campaign_name} — {t.subject}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nome da lista (interno)</Label>
            <Input value={listName} onChange={(e) => setListName(e.target.value)} />
          </div>
          <div>
            <Label>Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail" />
          </div>
          <div>
            <Label>Corpo (HTML)</Label>
            <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={10} placeholder="<p>Olá {{nome}}, ...</p>" />
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
          <Button onClick={handleSend} disabled={sending || withEmail.length === 0}>
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Disparar para {withEmail.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
