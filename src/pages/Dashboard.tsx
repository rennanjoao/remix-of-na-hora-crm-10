import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, Users, Calendar, TrendingUp, CheckCircle, Clock, XCircle, Video, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format, differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';
import { ptBR } from 'date-fns/locale';

interface Stats {
  totalLeads: number;
  leadsGanhos: number;
  leadsPerdidos: number;
  leadsEmAndamento: number;
  tasksPendentes: number;
  tasksCompletadas: number;
}

interface UpcomingMeeting {
  id: string;
  title: string;
  meeting_date: string;
  jitsi_link: string | null;
  contact_name: string | null;
  lead_name?: string;
}

const COLORS = ['hsl(217, 71%, 23%)', 'hsl(166, 64%, 42%)', 'hsl(142, 71%, 45%)', 'hsl(38, 92%, 50%)', 'hsl(0, 84%, 60%)'];

export default function Dashboard() {
  const { profile, role, isAdmin, isGerente } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalLeads: 0,
    leadsGanhos: 0,
    leadsPerdidos: 0,
    leadsEmAndamento: 0,
    tasksPendentes: 0,
    tasksCompletadas: 0,
  });
  const [leadsByStatus, setLeadsByStatus] = useState<{ name: string; value: number }[]>([]);
  const [upcomingMeetings, setUpcomingMeetings] = useState<UpcomingMeeting[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data: leads, error: leadsError } = await supabase.from('leads').select('status');
        if (leadsError) throw leadsError;
        
        if (leads) {
          const ganhos = leads.filter(l => l.status === 'ganho').length;
          const perdidos = leads.filter(l => l.status === 'perdido').length;
          const emAndamento = leads.filter(l => !['ganho', 'perdido'].includes(l.status || '')).length;

          setStats(prev => ({
            ...prev,
            totalLeads: leads.length,
            leadsGanhos: ganhos,
            leadsPerdidos: perdidos,
            leadsEmAndamento: emAndamento,
          }));

          const statusCount: Record<string, number> = {};
          leads.forEach(lead => {
            const status = lead.status || 'novo';
            statusCount[status] = (statusCount[status] || 0) + 1;
          });

          const statusLabels: Record<string, string> = {
            novo: 'Novo',
            contato: 'Contato',
            qualificado: 'Qualificado',
            proposta: 'Proposta',
            negociacao: 'Negociação',
            ganho: 'Ganho',
            perdido: 'Perdido',
          };

          setLeadsByStatus(
            Object.entries(statusCount).map(([key, value]) => ({
              name: statusLabels[key] || key,
              value,
            }))
          );
        }

        const { data: tasks, error: tasksError } = await supabase.from('tasks').select('completed');
        if (tasksError) throw tasksError;
        
        if (tasks) {
          setStats(prev => ({
            ...prev,
            tasksPendentes: tasks.filter(t => !t.completed).length,
            tasksCompletadas: tasks.filter(t => t.completed).length,
          }));
        }
      } catch (e) {
        console.error('Error fetching stats:', e);
        toast.error('Erro ao carregar dados', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
      }
    };

    const fetchUpcomingMeetings = async () => {
      if (!profile) return;
      try {
        const now = new Date().toISOString();
        let query = supabase
          .from('meetings')
          .select('id, title, meeting_date, jitsi_link, contact_name, lead_id')
          .gte('meeting_date', now)
          .order('meeting_date', { ascending: true })
          .limit(5);

        if (!isAdmin && !isGerente) {
          query = query.eq('sdr_id', profile.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        
        if (data && data.length > 0) {
          // Fetch lead names
          const leadIds = [...new Set(data.map(m => m.lead_id))];
          const { data: leads } = await supabase
            .from('leads')
            .select('id, razao_social, nome_fantasia')
            .in('id', leadIds);
          
          const leadMap = new Map(leads?.map(l => [l.id, l.nome_fantasia || l.razao_social]) || []);
          
          setUpcomingMeetings(data.map(m => ({
            ...m,
            lead_name: leadMap.get(m.lead_id) || 'Empresa',
          })));
        }
      } catch (e) {
        console.error('Error fetching upcoming meetings:', e);
        toast.error('Erro ao carregar reuniões', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
      }
    };

    fetchStats();
    fetchUpcomingMeetings();
  }, [profile]);

  const conversionData = [
    { name: 'Ganhos', value: stats.leadsGanhos, fill: 'hsl(142, 71%, 45%)' },
    { name: 'Perdidos', value: stats.leadsPerdidos, fill: 'hsl(0, 84%, 60%)' },
    { name: 'Em Andamento', value: stats.leadsEmAndamento, fill: 'hsl(38, 92%, 50%)' },
  ];

  const getMeetingUrgency = (meetingDate: string) => {
    const diff = differenceInMinutes(new Date(meetingDate), new Date());
    if (diff <= 15 && diff >= 0) return 'urgent';
    if (diff <= 60 && diff >= 0) return 'soon';
    return 'normal';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Bem-vindo, {profile?.full_name?.split(' ')[0] || 'Usuário'}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Aqui está o resumo das suas atividades
          </p>
        </div>

        {/* Upcoming Meetings Alert */}
        {upcomingMeetings.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Video className="h-5 w-5 text-primary" />
                Próximas Reuniões
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingMeetings.map((meeting) => {
                  const urgency = getMeetingUrgency(meeting.meeting_date);
                  return (
                    <div
                      key={meeting.id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        urgency === 'urgent'
                          ? 'bg-destructive/10 border-destructive/30 animate-pulse'
                          : urgency === 'soon'
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-card'
                      }`}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-sm">{meeting.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {meeting.lead_name}
                          {meeting.contact_name && ` • ${meeting.contact_name}`}
                        </p>
                        <p className={`text-xs mt-1 font-medium ${
                          urgency === 'urgent' ? 'text-destructive' : 
                          urgency === 'soon' ? 'text-amber-600' : 'text-muted-foreground'
                        }`}>
                          {urgency === 'urgent' 
                            ? `⚠️ Em ${differenceInMinutes(new Date(meeting.meeting_date), new Date())} minutos!`
                            : format(new Date(meeting.meeting_date), "dd/MM 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={urgency === 'urgent' ? 'default' : 'outline'}
                        onClick={() => window.open(`${meeting.jitsi_link}#config.startWithVideoMuted=false`, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Entrar
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="metric-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de Leads</CardTitle>
              <Target className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalLeads}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.leadsEmAndamento} em andamento
              </p>
            </CardContent>
          </Card>

          <Card className="metric-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Leads Ganhos</CardTitle>
              <CheckCircle className="h-5 w-5 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">{stats.leadsGanhos}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.totalLeads > 0 ? ((stats.leadsGanhos / stats.totalLeads) * 100).toFixed(1) : 0}% de conversão
              </p>
            </CardContent>
          </Card>

          <Card className="metric-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Leads Perdidos</CardTitle>
              <XCircle className="h-5 w-5 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{stats.leadsPerdidos}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Oportunidades não convertidas
              </p>
            </CardContent>
          </Card>

          <Card className="metric-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tarefas Pendentes</CardTitle>
              <Clock className="h-5 w-5 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.tasksPendentes}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.tasksCompletadas} completadas
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Leads por Status</CardTitle>
              <CardDescription>Distribuição atual dos leads no funil</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leadsByStatus}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }} 
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Taxa de Conversão</CardTitle>
              <CardDescription>Proporção de leads ganhos vs perdidos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={conversionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {conversionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }} 
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-4">
                {conversionData.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span className="text-sm text-muted-foreground">{item.name}: {item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
