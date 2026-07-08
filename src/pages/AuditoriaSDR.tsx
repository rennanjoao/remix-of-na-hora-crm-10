import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Phone, Mail, MessageCircle, Download, Flag, Activity, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { SDRActivityTimeline } from '@/components/leads/SDRActivityTimeline';
import { format, subDays, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Profile { id: string; full_name: string | null; email: string; }
interface DayCount {
  day: string;
  call_made: number;
  email_sent: number;
  whatsapp_sent: number;
  lead_imported: number;
  status_change: number;
}

const ACTION_FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'call_made', label: 'Ligações' },
  { value: 'email_sent', label: 'E-mails' },
  { value: 'whatsapp_sent', label: 'WhatsApp' },
  { value: 'lead_imported', label: 'Importações' },
  { value: 'status_change', label: 'Mudança de status' },
];

export default function AuditoriaSDR() {
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [sdrId, setSdrId] = useState<string>('all');
  const [actionType, setActionType] = useState<string>('all');
  const [days, setDays] = useState<number>(7);
  const [kpis, setKpis] = useState({ call_made: 0, email_sent: 0, whatsapp_sent: 0, lead_imported: 0, status_change: 0, total: 0 });
  const [series, setSeries] = useState<DayCount[]>([]);

  const since = useMemo(() => startOfDay(subDays(new Date(), days - 1)), [days]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('id, full_name, email').eq('is_active', true);
        if (error) throw error;
        setSdrs((data ?? []) as Profile[]);
      } catch (e) {
        console.error('Error fetching SDRs:', e);
        toast.error('Erro ao carregar dados', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        let q = supabase.from('lead_activities')
          .select('action_type, created_at, user_id')
          .gte('created_at', since.toISOString())
          .limit(10000);
        if (sdrId !== 'all') q = q.eq('user_id', sdrId);
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []) as { action_type: string; created_at: string }[];

        const today = new Date();
        const isToday = (iso: string) => new Date(iso).toDateString() === today.toDateString();
        const todayRows = rows.filter(r => isToday(r.created_at));
        const kCount = (t: string) => todayRows.filter(r => r.action_type === t).length;
        setKpis({
          call_made: kCount('call_made'),
          email_sent: kCount('email_sent'),
          whatsapp_sent: kCount('whatsapp_sent'),
          lead_imported: kCount('lead_imported'),
          status_change: kCount('status_change'),
          total: todayRows.length,
        });

        const byDay = new Map<string, DayCount>();
        for (let i = 0; i < days; i++) {
          const d = startOfDay(subDays(new Date(), days - 1 - i));
          const key = format(d, 'yyyy-MM-dd');
          byDay.set(key, { day: format(d, 'dd/MM', { locale: ptBR }), call_made: 0, email_sent: 0, whatsapp_sent: 0, lead_imported: 0, status_change: 0 });
        }
        for (const r of rows) {
          const key = format(new Date(r.created_at), 'yyyy-MM-dd');
          const bucket = byDay.get(key);
          if (!bucket) continue;
          const b = bucket as unknown as Record<string, number | string>;
          if (r.action_type in b) b[r.action_type] = (b[r.action_type] as number) + 1;
        }
        setSeries(Array.from(byDay.values()));
      } catch (e) {
        console.error('Error fetching activities:', e);
        toast.error('Erro ao carregar dados', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
      }
    })();
  }, [sdrId, since, days]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="h-6 w-6" /> Auditoria de SDR</h1>
            <p className="text-sm text-muted-foreground">KPIs de produtividade e timeline de atividades por SDR.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sdrId} onValueChange={setSdrId}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos SDRs</SelectItem>
                {sdrs.map(s => <SelectItem key={s.id} value={s.id}>{s.full_name ?? s.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_FILTERS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="14">Últimos 14 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard label="Total hoje" value={kpis.total} icon={Activity} />
          <KpiCard label="Ligações" value={kpis.call_made} icon={Phone} />
          <KpiCard label="E-mails" value={kpis.email_sent} icon={Mail} />
          <KpiCard label="WhatsApp" value={kpis.whatsapp_sent} icon={MessageCircle} />
          <KpiCard label="Importados" value={kpis.lead_imported} icon={Download} />
          <KpiCard label="Status" value={kpis.status_change} icon={Flag} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolução da produtividade — últimos {days} dias</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="call_made" name="Ligações" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="email_sent" name="E-mails" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="whatsapp_sent" name="WhatsApp" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="lead_imported" name="Importados" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="status_change" name="Status" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Timeline de atividades</CardTitle></CardHeader>
          <CardContent>
            <SDRActivityTimeline
              sdrId={sdrId === 'all' ? null : sdrId}
              since={since}
              actionType={actionType === 'all' ? null : actionType}
            />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function KpiCard({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <Icon className="h-6 w-6 text-primary/60" />
      </CardContent>
    </Card>
  );
}
