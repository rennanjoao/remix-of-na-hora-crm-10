import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { CalendarIcon, Video, Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Lead {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  email: string | null;
  telefone: string | null;
}

interface SDRProfile {
  id: string;
  full_name: string | null;
}

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onMeetingCreated?: () => void;
  /**
   * @deprecated Não é mais necessário passar a lista completa de leads.
   * O modal busca sob demanda com paginação/busca. Mantido apenas por
   * compatibilidade — se passado, é ignorado.
   */
  leads?: Lead[];
}

const SEARCH_LIMIT = 25;

/** Combobox de leads com busca server-side (evita carregar a tabela inteira). */
function LeadCombobox({
  value, onChange,
}: { value: Lead | null; onChange: (l: Lead) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('leads')
          .select('id, razao_social, nome_fantasia, email, telefone')
          .order('updated_at', { ascending: false })
          .limit(SEARCH_LIMIT);
        const term = q.trim();
        if (term) {
          const like = `%${term}%`;
          query = query.or(`razao_social.ilike.${like},nome_fantasia.ilike.${like},email.ilike.${like}`);
        }
        const { data } = await query;
        setRows((data ?? []) as Lead[]);
      } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(handle);
  }, [q, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value ? (value.nome_fantasia || value.razao_social) : 'Selecione a empresa'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar por nome ou e-mail..." value={q} onValueChange={setQ} />
          <CommandList>
            {loading && <div className="py-3 text-center text-xs text-muted-foreground">Buscando...</div>}
            {!loading && rows.length === 0 && <CommandEmpty>Nenhum lead encontrado</CommandEmpty>}
            <CommandGroup>
              {rows.map((l) => (
                <CommandItem
                  key={l.id}
                  value={l.id}
                  onSelect={() => { onChange(l); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value?.id === l.id ? 'opacity-100' : 'opacity-0')} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{l.nome_fantasia || l.razao_social}</div>
                    {l.email && <div className="truncate text-xs text-muted-foreground">{l.email}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ScheduleMeetingModal({ open, onOpenChange, lead, onMeetingCreated }: ScheduleMeetingModalProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const activeLead = useMemo(() => lead || selectedLead, [lead, selectedLead]);
  const { profile, isAdmin } = useAuth();
  const [sdrs, setSdrs] = useState<SDRProfile[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    contact_name: '',
    start_time: '09:00',
    duration: '30',
    sdr_id: '',
  });

  useEffect(() => {
    if (activeLead) {
      setForm(prev => ({
        ...prev,
        title: prev.title || `Reunião com ${activeLead.nome_fantasia || activeLead.razao_social}`,
      }));
    }
  }, [activeLead]);

  useEffect(() => {
    if (profile && !isAdmin) {
      setForm(prev => ({ ...prev, sdr_id: profile.id }));
    }
  }, [profile, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchSDRs = async () => {
      const { data: roles } = await supabase
        .from('user_roles').select('user_id').eq('role', 'sdr');
      if (roles && roles.length > 0) {
        const userIds = roles.map(r => r.user_id);
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name, user_id').in('user_id', userIds);
        setSdrs(profiles?.map(p => ({ id: p.id, full_name: p.full_name })) || []);
      }
    };
    fetchSDRs();
  }, [isAdmin]);

  const handleSave = async () => {
    if (!activeLead || !profile || !selectedDate || !form.start_time) return;

    const sdrId = form.sdr_id || profile.id;

    setSaving(true);
    try {
      const meetingDate = new Date(`${format(selectedDate, 'yyyy-MM-dd')}T${form.start_time}`);

      const { data, error } = await supabase.functions.invoke('schedule-meeting', {
        body: {
          lead_id: activeLead.id,
          sdr_id: sdrId,
          title: form.title,
          description: form.description || undefined,
          start_time: meetingDate.toISOString(),
          duration_minutes: parseInt(form.duration),
          contact_name: form.contact_name || undefined,
          decisor_email: activeLead.email || undefined,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erro no agendamento');

      const linkLabel = data.source === 'google_meet' ? 'Google Meet' : 'Jitsi (fallback)';
      await supabase.from('lead_timeline').insert({
        lead_id: activeLead.id,
        author_id: profile.id,
        content: `📅 Reunião agendada (${linkLabel}): ${form.title} — ${format(meetingDate, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}\n🔗 ${data.meeting_link}`,
        contact_type: 'meeting',
      });

      toast.success(`Reunião agendada! Link: ${linkLabel}`);
      onOpenChange(false);
      setSelectedDate(undefined);
      setSelectedLead(null);
      setForm({ title: '', description: '', contact_name: '', start_time: '09:00', duration: '30', sdr_id: profile?.id || '' });
      onMeetingCreated?.();
    } catch (error) {
      console.error('Error creating meeting:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao agendar reunião');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            Agendar Reunião
          </DialogTitle>
          <DialogDescription>
            {activeLead ? `Empresa: ${activeLead.nome_fantasia || activeLead.razao_social}` : 'Selecione uma empresa'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!lead && (
            <div className="space-y-2">
              <Label>Empresa</Label>
              <LeadCombobox value={selectedLead} onChange={setSelectedLead} />
            </div>
          )}
          <div className="space-y-2">
            <Label>Título da Reunião</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Reunião de apresentação"
            />
          </div>

          <div className="space-y-2">
            <Label>Contato Principal</Label>
            <Input
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              placeholder="Nome do contato na empresa"
            />
          </div>

          <div className="space-y-2">
            <Label>Data</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP", { locale: ptBR }) : <span>Selecione a data</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  initialFocus
                  className="pointer-events-auto"
                  disabled={(date) => date < new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Horário</Label>
              <Input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Duração (min)</Label>
              <Select value={form.duration} onValueChange={(v) => setForm({ ...form, duration: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="45">45 min</SelectItem>
                  <SelectItem value="60">1 hora</SelectItem>
                  <SelectItem value="90">1h30</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isAdmin && sdrs.length > 0 && (
            <div className="space-y-2">
              <Label>SDR Responsável</Label>
              <Select value={form.sdr_id} onValueChange={(v) => setForm({ ...form, sdr_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione o SDR" /></SelectTrigger>
                <SelectContent>
                  {sdrs.map(sdr => (
                    <SelectItem key={sdr.id} value={sdr.id}>{sdr.full_name || 'Sem nome'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Pauta, objetivos da reunião..."
              rows={3}
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">🔗 Link da reunião</p>
            <p>Google Meet real quando as credenciais estão configuradas — senão, Jitsi como fallback.</p>
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving || !form.title || !selectedDate || !activeLead}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Video className="h-4 w-4 mr-2" />}
            Agendar Reunião
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
