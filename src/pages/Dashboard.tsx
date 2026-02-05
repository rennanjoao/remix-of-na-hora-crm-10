import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, Users, Calendar, TrendingUp, CheckCircle, Clock, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface Stats {
  totalLeads: number;
  leadsGanhos: number;
  leadsPerdidos: number;
  leadsEmAndamento: number;
  tasksPendentes: number;
  tasksCompletadas: number;
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

  useEffect(() => {
    const fetchStats = async () => {
      // Fetch leads stats
      const { data: leads } = await supabase.from('leads').select('status');
      
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

        // Group by status for chart
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

      // Fetch tasks stats
      const { data: tasks } = await supabase.from('tasks').select('completed');
      
      if (tasks) {
        setStats(prev => ({
          ...prev,
          tasksPendentes: tasks.filter(t => !t.completed).length,
          tasksCompletadas: tasks.filter(t => t.completed).length,
        }));
      }
    };

    fetchStats();
  }, []);

  const conversionData = [
    { name: 'Ganhos', value: stats.leadsGanhos, fill: 'hsl(142, 71%, 45%)' },
    { name: 'Perdidos', value: stats.leadsPerdidos, fill: 'hsl(0, 84%, 60%)' },
    { name: 'Em Andamento', value: stats.leadsEmAndamento, fill: 'hsl(38, 92%, 50%)' },
  ];

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
