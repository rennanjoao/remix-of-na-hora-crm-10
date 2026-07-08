import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, Loader2, Radio } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { LeadActivityType } from '@/lib/lead-activities';

interface Row {
  id: string;
  action_type: LeadActivityType;
  description: string;
  created_at: string;
  user_id: string | null;
  lead_id: string;
  profiles?: { full_name: string | null } | null;
  leads?: { razao_social: string | null; nome_fantasia: string | null } | null;
}

const ACTION_LABEL: Record<LeadActivityType, string> = {
  status_change: 'Status alterado',
  note_added: 'Nota adicionada',
  email_sent: 'E-mail enviado',
  call_made: 'Ligação realizada',
  viewed: 'Visualização',
  meeting_scheduled: 'Reunião agendada',
  lead_created: 'Lead criado',
  lead_imported: 'Lead importado',
  whatsapp_sent: 'WhatsApp enviado',
  campaign_enrolled: 'Cadência iniciada',
  field_updated: 'Campo editado',
};

export function TeamActivityFeed() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [sdrFilter, setSdrFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data } = await (supabase.from as unknown as (t: string) => {
        select: (cols: string) => {
          gte: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: Row[] | null }>;
            };
          };
        };
      })('lead_activities')
        .select('id, action_type, description, created_at, user_id, lead_id, profiles:user_id (full_name), leads:lead_id (razao_social, nome_fantasia)')
        .gte('created_at', startOfDay.toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      if (!active) return;
      setRows(data ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel('team-activity-feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lead_activities' },
        async (payload) => {
          const base = payload.new as Row;
          // hydrate names in background
          const [{ data: profile }, { data: lead }] = await Promise.all([
            base.user_id
              ? supabase.from('profiles').select('full_name').eq('id', base.user_id).maybeSingle()
              : Promise.resolve({ data: null }),
            supabase.from('leads').select('razao_social, nome_fantasia').eq('id', base.lead_id).maybeSingle(),
          ]);
          setRows(prev => [{ ...base, profiles: profile as { full_name: string | null } | null, leads: lead as { razao_social: string | null; nome_fantasia: string | null } | null }, ...prev].slice(0, 300));
        }
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const sdrs = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach(r => {
      if (r.user_id && r.profiles?.full_name) seen.set(r.user_id, r.profiles.full_name);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const filtered = rows.filter(r =>
    (sdrFilter === 'all' || r.user_id === sdrFilter) &&
    (actionFilter === 'all' || r.action_type === actionFilter)
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Feed de Atividades da Equipe
            <Badge variant="outline" className="ml-1 gap-1 text-[10px] h-5">
              <Radio className="h-2.5 w-2.5 text-emerald-500 animate-pulse" /> ao vivo
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Ações do dia — atualiza em tempo real</p>
        </div>
        <div className="flex gap-2">
          <Select value={sdrFilter} onValueChange={setSdrFilter}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="SDR" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os SDRs</SelectItem>
              {sdrs.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Ação" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as ações</SelectItem>
              {Object.entries(ACTION_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[480px]">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">Nenhuma atividade encontrada.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map(r => {
                const leadName = r.leads?.nome_fantasia || r.leads?.razao_social || 'Lead';
                return (
                  <li key={r.id} className="px-4 py-2.5 hover:bg-muted/40 transition">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="text-[10px] h-5">{ACTION_LABEL[r.action_type]}</Badge>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(r.created_at), "HH:mm:ss", { locale: ptBR })}</span>
                    </div>
                    <p className="text-sm mt-1">
                      <span className="font-medium">{r.profiles?.full_name ?? 'Sistema'}</span>{' '}
                      <span className="text-muted-foreground">→</span>{' '}
                      <span className="font-medium">{leadName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
