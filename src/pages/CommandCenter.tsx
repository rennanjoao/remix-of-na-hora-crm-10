import { useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TeamActivityFeed } from '@/components/leads/TeamActivityFeed';
import { useRoleGuard } from '@/hooks/useRoleGuard';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Activity, Maximize2, Minimize2, UserPlus, Mail, Video, Target, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

type EventKind = 'lead_novo' | 'lead_status' | 'timeline' | 'email' | 'meeting';

interface FeedEvent {
  id: string;
  kind: EventKind;
  title: string;
  detail: string;
  sdrName?: string;
  at: string; // ISO
}

interface SdrPerfRow {
  sdr_id: string;
  full_name: string;
  dia: string;
  consultas_realizadas: number;
  leads_importados: number;
  reunioes_agendadas: number;
  emails_enviados: number;
}

const KIND_META: Record<EventKind, { label: string; icon: any; className: string }> = {
  lead_novo:   { label: 'Novo lead',        icon: UserPlus, className: 'bg-blue-500/10 text-blue-600' },
  lead_status: { label: 'Status alterado',  icon: Target,   className: 'bg-purple-500/10 text-purple-600' },
  timeline:    { label: 'Interação',        icon: Activity, className: 'bg-teal-500/10 text-teal-600' },
  email:       { label: 'E-mail enviado',   icon: Mail,     className: 'bg-orange-500/10 text-orange-600' },
  meeting:     { label: 'Reunião agendada', icon: Video,    className: 'bg-emerald-500/10 text-emerald-600' },
};

function relTime(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `há ${Math.max(1, Math.floor(d))}s`;
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleString('pt-BR');
}

export default function CommandCenter() {
  const { isAllowed, loading: guardLoading } = useRoleGuard(['admin', 'gerente'], '/dashboard');
  const [fullscreen, setFullscreen] = useState(false);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [perf, setPerf] = useState<SdrPerfRow[]>([]);
  const [loadingPerf, setLoadingPerf] = useState(true);
  const profileCache = useRef<Map<string, string>>(new Map());

  const pushEvent = (ev: FeedEvent) => {
    setEvents(prev => [ev, ...prev].slice(0, 100));
  };

  const resolveSdrName = async (profileId?: string | null) => {
    if (!profileId) return undefined;
    if (profileCache.current.has(profileId)) return profileCache.current.get(profileId);
    const { data } = await supabase.from('profiles').select('full_name').eq('id', profileId).maybeSingle();
    const name = data?.full_name ?? 'SDR';
    profileCache.current.set(profileId, name);
    return name;
  };

  const fetchPerf = async () => {
    setLoadingPerf(true);
    const { data, error } = await (supabase as any).rpc('get_sdr_performance', { _days: 1 });
    if (!error && data) setPerf(data as SdrPerfRow[]);
    setLoadingPerf(false);
  };

  useEffect(() => {
    if (!isAllowed) return;
    fetchPerf();
    const interval = setInterval(fetchPerf, 30_000);

    const channel = supabase
      .channel('command-center')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, async (payload) => {
        const row: any = payload.new;
        const sdrName = await resolveSdrName(row.assigned_to ?? row.created_by);
        pushEvent({
          id: `lead-${row.id}-${Date.now()}`,
          kind: 'lead_novo',
          title: row.company_name ?? 'Novo lead',
          detail: `${row.city ?? ''}${row.category ? ' • ' + row.category : ''}`,
          sdrName,
          at: row.created_at ?? new Date().toISOString(),
        });
        fetchPerf();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, async (payload) => {
        const row: any = payload.new;
        const old: any = payload.old;
        if (row.status === old.status && row.contact_outcome === old.contact_outcome) return;
        const sdrName = await resolveSdrName(row.assigned_to);
        pushEvent({
          id: `leadu-${row.id}-${Date.now()}`,
          kind: 'lead_status',
          title: row.company_name ?? 'Lead',
          detail: `${old.status ?? '-'} → ${row.status ?? '-'}${row.contact_outcome ? ' (' + row.contact_outcome + ')' : ''}`,
          sdrName,
          at: new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_timeline' }, async (payload) => {
        const row: any = payload.new;
        pushEvent({
          id: `tl-${row.id}`,
          kind: 'timeline',
          title: row.contact_type ?? 'Interação',
          detail: row.notes ?? row.description ?? '',
          at: row.created_at ?? new Date().toISOString(),
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_sends' }, async (payload) => {
        const row: any = payload.new;
        const sdrName = await resolveSdrName(row.sdr_id);
        pushEvent({
          id: `em-${row.id}`,
          kind: 'email',
          title: row.subject ?? 'E-mail',
          detail: row.recipient_email ?? '',
          sdrName,
          at: row.created_at ?? new Date().toISOString(),
        });
        fetchPerf();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meetings' }, async (payload) => {
        const row: any = payload.new;
        const sdrName = await resolveSdrName(row.sdr_id);
        pushEvent({
          id: `mt-${row.id}`,
          kind: 'meeting',
          title: row.title ?? 'Reunião',
          detail: row.start_time ? new Date(row.start_time).toLocaleString('pt-BR') : '',
          sdrName,
          at: row.created_at ?? new Date().toISOString(),
        });
        fetchPerf();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllowed]);

  const perfByToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, SdrPerfRow>();
    for (const r of perf) {
      if (r.dia.slice(0, 10) === today) map.set(r.sdr_id, r);
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.leads_importados + b.reunioes_agendadas) - (a.leads_importados + a.reunioes_agendadas)
    );
  }, [perf]);

  if (guardLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }
  if (!isAllowed) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const Feed = ({ dense = false }: { dense?: boolean }) => (
    <ScrollArea className={cn('h-full', dense ? '' : '')}>
      <div className="space-y-2 p-2">
        {events.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Aguardando atividade em tempo real...
          </div>
        )}
        {events.map((ev) => {
          const meta = KIND_META[ev.kind];
          const Icon = meta.icon;
          return (
            <div
              key={ev.id}
              className="animate-in fade-in slide-in-from-top-2 duration-300 flex gap-3 rounded-lg border bg-card p-3"
            >
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', meta.className)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{ev.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{relTime(ev.at)}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{ev.detail}</div>
                {ev.sdrName && (
                  <Badge variant="secondary" className="mt-1 text-[10px]">{ev.sdrName}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );

  // FULLSCREEN MODE ------------
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-accent animate-pulse" />
            <h1 className="font-display text-xl font-bold">Command Center — Tela Cheia</h1>
          </div>
          <Button size="sm" variant="outline" onClick={() => setFullscreen(false)}>
            <Minimize2 className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
          <div className="overflow-auto p-6">
            {loadingPerf ? (
              <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {perfByToday.length === 0 && (
                  <div className="col-span-full text-center text-muted-foreground py-16">
                    Nenhuma atividade registrada hoje.
                  </div>
                )}
                {perfByToday.map(row => (
                  <Card key={row.sdr_id} className="border-2">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">{row.full_name}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <Stat label="Consultas" value={row.consultas_realizadas} />
                      <Stat label="Importados" value={row.leads_importados} />
                      <Stat label="E-mails" value={row.emails_enviados} />
                      <Stat label="Reuniões" value={row.reunioes_agendadas} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div className="border-l bg-muted/20 flex flex-col">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <Activity className="h-4 w-4" /> <span className="font-medium text-sm">Feed ao vivo</span>
            </div>
            <div className="flex-1 min-h-0"><Feed /></div>
          </div>
        </div>
      </div>
    );
  }

  // PANEL MODE ------------
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-accent animate-pulse" /> Command Center
            </h1>
            <p className="text-muted-foreground mt-1">Feed em tempo real da operação comercial</p>
          </div>
          <Button variant="outline" onClick={() => setFullscreen(true)}>
            <Maximize2 className="h-4 w-4 mr-2" /> Tela cheia
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Performance de hoje</CardTitle></CardHeader>
              <CardContent>
                {loadingPerf ? (
                  <Loader2 className="animate-spin" />
                ) : perfByToday.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma atividade registrada hoje.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {perfByToday.map(row => (
                      <div key={row.sdr_id} className="border rounded-lg p-3 space-y-2">
                        <div className="font-medium">{row.full_name}</div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <Stat small label="Consultas" value={row.consultas_realizadas} />
                          <Stat small label="Imports"   value={row.leads_importados} />
                          <Stat small label="E-mails"   value={row.emails_enviados} />
                          <Stat small label="Reuniões"  value={row.reunioes_agendadas} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <TeamActivityFeed />
          </div>

          <Card className="lg:sticky lg:top-20 h-[70vh] flex flex-col">
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Feed ao vivo</CardTitle></CardHeader>
            <CardContent className="flex-1 min-h-0 p-0"><Feed /></CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn('font-bold tabular-nums', small ? 'text-lg' : 'text-3xl')}>{value ?? 0}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}
