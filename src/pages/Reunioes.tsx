import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, Video, Trash2, ExternalLink, Plus, Zap, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';

interface MeetingRow {
  id: string;
  title: string;
  description: string | null;
  meeting_date: string;
  duration_minutes: number;
  jitsi_link: string;
  contact_name: string | null;
  sdr_id: string;
  lead_id: string;
  meeting_type: string;
  status: string;
  created_at: string;
}

interface LeadRef {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
}

export default function Reunioes() {
  const { profile, isAdmin, isSDR } = useAuth();
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [leadMap, setLeadMap] = useState<Record<string, LeadRef>>({});
  const [sdrMap, setSdrMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [jitsiRoom, setJitsiRoom] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: meetingsData, error: mErr } = await supabase
        .from('meetings').select('*').order('meeting_date', { ascending: false });
      if (mErr) throw mErr;

      const meetingsRows = (meetingsData as MeetingRow[]) || [];
      setMeetings(meetingsRows);

      // Só puxa leads e SDRs realmente referenciados — evita carregar tabelas inteiras.
      const leadIds = [...new Set(meetingsRows.map(m => m.lead_id).filter(Boolean))];
      const sdrIds = [...new Set(meetingsRows.map(m => m.sdr_id).filter(Boolean))];

      const [leadsRes, profilesRes] = await Promise.all([
        leadIds.length
          ? supabase.from('leads').select('id, razao_social, nome_fantasia').in('id', leadIds)
          : Promise.resolve({ data: [], error: null } as { data: LeadRef[]; error: null }),
        sdrIds.length
          ? supabase.from('profiles').select('id, full_name').in('id', sdrIds)
          : Promise.resolve({ data: [], error: null } as { data: { id: string; full_name: string | null }[]; error: null }),
      ]);

      const lMap: Record<string, LeadRef> = {};
      (leadsRes.data || []).forEach((l) => { lMap[l.id] = l; });
      setLeadMap(lMap);

      const sMap: Record<string, string> = {};
      (profilesRes.data || []).forEach((p) => { sMap[p.id] = p.full_name || 'Sem nome'; });
      setSdrMap(sMap);
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erro ao carregar reuniões');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const startInstantMeeting = async () => {
    if (!profile) return;
    try {
      const roomId = `NaHora-Instantanea-${Date.now()}`;
      const jitsiLink = `https://meet.jit.si/${roomId}`;

      const { error } = await supabase.from('meetings').insert({
        title: 'Reunião Instantânea',
        meeting_date: new Date().toISOString(),
        duration_minutes: 30,
        jitsi_link: jitsiLink,
        sdr_id: profile.id,
        created_by: profile.id,
        lead_id: profile.id, // fallback: reunião sem lead vinculado
        meeting_type: 'instant',
        status: 'em_andamento',
      });

      if (error) throw error;
      toast.success('Sala criada!');
      setJitsiRoom(jitsiLink);
      fetchAll();
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erro ao criar reunião instantânea');
    }
  };

  const deleteMeeting = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('meetings').delete().eq('id', id);
      if (error) throw error;
      setMeetings(prev => prev.filter(m => m.id !== id));
      toast.success('Reunião removida');
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erro ao deletar reunião');
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status: string, meetingDate: string) => {
    const isPast = new Date(meetingDate) < new Date();
    if (isPast && status !== 'concluida') {
      return <Badge variant="secondary">Concluída</Badge>;
    }
    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      agendada: { label: 'Agendada', variant: 'default' },
      em_andamento: { label: 'Em Andamento', variant: 'outline' },
      concluida: { label: 'Concluída', variant: 'secondary' },
    };
    const v = variants[status] || variants.agendada;
    return <Badge variant={v.variant}>{v.label}</Badge>;
  };

  const getTypeBadge = (type: string) => {
    if (type === 'instant') return <Badge variant="outline" className="text-amber-600 border-amber-600">Instantânea</Badge>;
    return <Badge variant="outline">Agendada</Badge>;
  };

  const filteredMeetings = meetings.filter(m => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'instant') return m.meeting_type === 'instant';
    if (statusFilter === 'concluida') return new Date(m.meeting_date) < new Date();
    if (statusFilter === 'agendada') return m.status === 'agendada' && new Date(m.meeting_date) >= new Date();
    return true;
  });

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {jitsiRoom && (
          <Card className="border-primary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Video className="h-5 w-5 text-primary" />
                  Reunião em Andamento
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setJitsiRoom(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <iframe
                src={`${jitsiRoom}#config.startWithVideoMuted=false&config.prejoinPageEnabled=false`}
                className="w-full rounded-lg border"
                style={{ height: '500px' }}
                allow="camera; microphone; fullscreen; display-capture; autoplay"
                title="Jitsi Meeting"
              />
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">Reuniões</h1>
            <p className="text-muted-foreground mt-1">Gerencie videoconferências e chamadas</p>
          </div>
          <div className="flex items-center gap-3">
            {(isAdmin || isSDR) && (
              <>
                <Button variant="outline" onClick={startInstantMeeting}>
                  <Zap className="h-4 w-4 mr-2" />
                  Iniciar Agora
                </Button>
                <Button onClick={() => setScheduleOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agendar Reunião
                </Button>
              </>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  Lista de Chamadas
                </CardTitle>
                <CardDescription>{filteredMeetings.length} reuniões</CardDescription>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Filtrar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="agendada">Agendadas</SelectItem>
                  <SelectItem value="concluida">Concluídas</SelectItem>
                  <SelectItem value="instant">Instantâneas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>SDR</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMeetings.map((meeting) => {
                  const lead = leadMap[meeting.lead_id];
                  return (
                    <TableRow key={meeting.id}>
                      <TableCell className="font-medium">{meeting.title}</TableCell>
                      <TableCell>{lead?.nome_fantasia || lead?.razao_social || '-'}</TableCell>
                      <TableCell>
                        {format(new Date(meeting.meeting_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>{sdrMap[meeting.sdr_id] || '-'}</TableCell>
                      <TableCell>{getTypeBadge(meeting.meeting_type)}</TableCell>
                      <TableCell>{getStatusBadge(meeting.status, meeting.meeting_date)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setJitsiRoom(meeting.jitsi_link)}>
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Entrar
                          </Button>
                          {(isAdmin || isSDR) && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Deletar Reunião?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Essa ação não pode ser desfeita. A reunião "{meeting.title}" será removida permanentemente.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteMeeting(meeting.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    {deletingId === meeting.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deletar'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filteredMeetings.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                Nenhuma reunião encontrada
              </div>
            )}
          </CardContent>
        </Card>

        <ScheduleMeetingModal
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          lead={null}
          onMeetingCreated={fetchAll}
        />
      </div>
    </DashboardLayout>
  );
}
