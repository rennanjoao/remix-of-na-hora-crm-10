import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, MessageSquareText, Plus, Pencil, Trash2 } from 'lucide-react';
import { invalidateScriptsCache, type ApproachScript } from '@/lib/approach-scripts';

const scriptsTable = () => supabase.from('approach_scripts');

export function ScriptsManager() {
  const [scripts, setScripts] = useState<ApproachScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ApproachScript | null>(null);

  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [body, setBody] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await scriptsTable()
      .select('*')
      .order('channel', { ascending: true })
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) toast.error('Erro ao carregar scripts');
    else setScripts((data || []) as ApproachScript[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setName(''); setChannel('whatsapp'); setBody(''); setIsDefault(false);
    setDialogOpen(true);
  };

  const openEdit = (s: ApproachScript) => {
    setEditing(s);
    setName(s.name); setChannel(s.channel as 'whatsapp' | 'email'); setBody(s.body); setIsDefault(s.is_default);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) { toast.error('Nome e conteúdo são obrigatórios'); return; }
    setSaving(true);
    try {
      // Garantir apenas 1 default por canal
      if (isDefault) {
        await scriptsTable().update({ is_default: false }).eq('channel', channel).neq('id', editing?.id || '00000000-0000-0000-0000-000000000000');
      }
      if (editing) {
        const { error } = await scriptsTable()
          .update({ name, channel, body, is_default: isDefault })
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Script atualizado');
      } else {
        const { error } = await scriptsTable().insert({ name, channel, body, is_default: isDefault });
        if (error) throw error;
        toast.success('Script criado');
      }
      invalidateScriptsCache();
      setDialogOpen(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: ApproachScript) => {
    if (!confirm(`Excluir "${s.name}"?`)) return;
    const { error } = await scriptsTable().delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    invalidateScriptsCache();
    toast.success('Script excluído');
    load();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5" /> Scripts de Abordagem
            </CardTitle>
            <CardDescription>
              Biblioteca de mensagens para WhatsApp/e-mail. Variáveis suportadas: <code>{'{nome}'}</code>, <code>{'{cidade}'}</code>, <code>{'{segmento}'}</code>.
              Apenas 1 script padrão por canal (usado automaticamente na prospecção).
            </CardDescription>
          </div>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Novo script</Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : scripts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Nenhum script cadastrado.</div>
        ) : (
          <div className="space-y-3">
            {scripts.map(s => (
              <div key={s.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">{s.channel}</Badge>
                      {s.is_default && <Badge className="text-[10px]">padrão</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{s.body}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar script' : 'Novo script'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: WhatsApp - Abertura por segmento" />
            </div>
            <div className="space-y-1.5">
              <Label>Canal</Label>
              <Select value={channel} onValueChange={(v: 'whatsapp' | 'email') => setChannel(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
                placeholder="Olá! Vi que vocês atuam no segmento {segmento} em {cidade}..." />
              <p className="text-[10px] text-muted-foreground">
                Use <code>{'{nome}'}</code>, <code>{'{cidade}'}</code>, <code>{'{segmento}'}</code> — substituídos automaticamente na hora do envio.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Label className="text-sm">Script padrão deste canal</Label>
                <p className="text-xs text-muted-foreground">Usado automaticamente na prospecção.</p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
