import { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { Loader2, Plus, ChevronLeft, ChevronRight, CalendarIcon, Clock, Check } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, isToday, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  completed: boolean;
  assigned_to: string;
  lead_id: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
}

type ViewMode = 'month' | 'week' | 'day';

export default function Calendario() {
  const { profile, isAdmin, isGerente, isSDR } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sdrs, setSdrs] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedSDR, setSelectedSDR] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    all_day: false,
  });

  const canViewAllCalendars = isAdmin || isGerente;

  const fetchTasks = async () => {
    setLoading(true);
    try {
      let query = supabase.from('tasks').select('*');

      // If not admin/gerente, only fetch own tasks
      if (!canViewAllCalendars && profile) {
        query = query.eq('assigned_to', profile.id);
      }

      const { data, error } = await query.order('start_time', { ascending: true });
      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error('Erro ao carregar tarefas');
    } finally {
      setLoading(false);
    }
  };

  const fetchSDRs = async () => {
    if (!canViewAllCalendars) return;

    try {
      // Fetch all profiles that are SDRs
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'sdr');

      if (roles && roles.length > 0) {
        const userIds = roles.map(r => r.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('user_id', userIds);

        setSdrs(profiles || []);
      }
    } catch (error) {
      console.error('Error fetching SDRs:', error);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchSDRs();
  }, [profile, canViewAllCalendars]);

  const createTask = async () => {
    if (!profile || !newTask.title.trim() || !selectedDate) return;

    try {
      const startTime = newTask.start_time 
        ? new Date(`${format(selectedDate, 'yyyy-MM-dd')}T${newTask.start_time}`)
        : selectedDate;

      const endTime = newTask.end_time
        ? new Date(`${format(selectedDate, 'yyyy-MM-dd')}T${newTask.end_time}`)
        : null;

      const { error } = await supabase.from('tasks').insert({
        title: newTask.title,
        description: newTask.description || null,
        start_time: startTime.toISOString(),
        end_time: endTime?.toISOString() || null,
        all_day: newTask.all_day,
        assigned_to: profile.id,
        created_by: profile.id,
      });

      if (error) throw error;

      toast.success('Tarefa criada!');
      setDialogOpen(false);
      setNewTask({ title: '', description: '', start_time: '', end_time: '', all_day: false });
      setSelectedDate(undefined);
      fetchTasks();
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Erro ao criar tarefa');
    }
  };

  const toggleTaskComplete = async (taskId: string, completed: boolean) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ completed: !completed })
        .eq('id', taskId);

      if (error) throw error;

      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, completed: !completed } : t
      ));
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Erro ao atualizar tarefa');
    }
  };

  // Filter tasks by selected SDR
  const filteredTasks = useMemo(() => {
    if (selectedSDR === 'all') return tasks;
    return tasks.filter(t => t.assigned_to === selectedSDR);
  }, [tasks, selectedSDR]);

  // Get days for calendar
  const calendarDays = useMemo(() => {
    if (viewMode === 'month') {
      const start = startOfWeek(startOfMonth(currentDate), { locale: ptBR });
      const end = endOfWeek(endOfMonth(currentDate), { locale: ptBR });
      return eachDayOfInterval({ start, end });
    } else if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { locale: ptBR });
      const end = endOfWeek(currentDate, { locale: ptBR });
      return eachDayOfInterval({ start, end });
    } else {
      return [currentDate];
    }
  }, [currentDate, viewMode]);

  // Get tasks for a specific day
  const getTasksForDay = (date: Date) => {
    return filteredTasks.filter(task => 
      isSameDay(new Date(task.start_time), date)
    );
  };

  const navigate = (direction: 'prev' | 'next') => {
    if (viewMode === 'month') {
      setCurrentDate(direction === 'prev' ? subMonths(currentDate, 1) : addMonths(currentDate, 1));
    } else if (viewMode === 'week') {
      setCurrentDate(direction === 'prev' ? addDays(currentDate, -7) : addDays(currentDate, 7));
    } else {
      setCurrentDate(direction === 'prev' ? addDays(currentDate, -1) : addDays(currentDate, 1));
    }
  };

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
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold">Calendário</h1>
            <p className="text-muted-foreground mt-1">
              {canViewAllCalendars 
                ? 'Visualize o calendário de todos os SDRs' 
                : 'Gerencie suas tarefas e compromissos'}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {canViewAllCalendars && sdrs.length > 0 && (
              <Select value={selectedSDR} onValueChange={setSelectedSDR}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filtrar por SDR" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os SDRs</SelectItem>
                  {sdrs.map(sdr => (
                    <SelectItem key={sdr.id} value={sdr.id}>
                      {sdr.full_name || 'Sem nome'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Tarefa
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova Tarefa</DialogTitle>
                  <DialogDescription>
                    Agende uma nova tarefa ou reunião
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Título</Label>
                    <Input
                      placeholder="Ex: Reunião com cliente"
                      value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      placeholder="Detalhes da tarefa..."
                      value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Data</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !selectedDate && "text-muted-foreground"
                          )}
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
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Hora Início</Label>
                      <Input
                        type="time"
                        value={newTask.start_time}
                        onChange={(e) => setNewTask({ ...newTask, start_time: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hora Fim</Label>
                      <Input
                        type="time"
                        value={newTask.end_time}
                        onChange={(e) => setNewTask({ ...newTask, end_time: e.target.value })}
                      />
                    </div>
                  </div>
                  <Button 
                    onClick={createTask} 
                    className="w-full"
                    disabled={!newTask.title.trim() || !selectedDate}
                  >
                    Criar Tarefa
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Calendar Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => navigate('prev')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <CardTitle className="font-display">
                  {format(currentDate, viewMode === 'day' ? "dd 'de' MMMM 'de' yyyy" : "MMMM 'de' yyyy", { locale: ptBR })}
                </CardTitle>
                <Button variant="outline" size="icon" onClick={() => navigate('next')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-1">
                {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === 'day' ? 'Dia' : mode === 'week' ? 'Semana' : 'Mês'}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Calendar Grid */}
            <div className={cn(
              "grid gap-1",
              viewMode === 'month' && "grid-cols-7",
              viewMode === 'week' && "grid-cols-7",
              viewMode === 'day' && "grid-cols-1"
            )}>
              {/* Day Headers */}
              {viewMode !== 'day' && (
                ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
                  <div key={day} className="py-2 text-center text-sm font-medium text-muted-foreground">
                    {day}
                  </div>
                ))
              )}

              {/* Calendar Days */}
              {calendarDays.map((day, index) => {
                const dayTasks = getTasksForDay(day);
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isCurrentDay = isToday(day);

                return (
                  <div
                    key={index}
                    className={cn(
                      "min-h-[100px] p-2 border rounded-lg",
                      !isCurrentMonth && "opacity-40",
                      isCurrentDay && "bg-accent/10 border-accent",
                      viewMode === 'day' && "min-h-[400px]"
                    )}
                  >
                    <div className={cn(
                      "text-sm font-medium mb-2",
                      isCurrentDay && "text-accent"
                    )}>
                      {format(day, viewMode === 'day' ? "EEEE, d 'de' MMMM" : 'd', { locale: ptBR })}
                    </div>
                    <div className="space-y-1">
                      {dayTasks.slice(0, viewMode === 'day' ? undefined : 3).map((task) => (
                        <div
                          key={task.id}
                          className={cn(
                            "calendar-event flex items-center gap-1",
                            task.completed 
                              ? "bg-muted text-muted-foreground line-through" 
                              : "bg-primary text-primary-foreground"
                          )}
                          onClick={() => toggleTaskComplete(task.id, task.completed)}
                        >
                          {task.completed && <Check className="h-3 w-3" />}
                          {!task.all_day && (
                            <span className="text-[10px] opacity-80">
                              {format(new Date(task.start_time), 'HH:mm')}
                            </span>
                          )}
                          <span className="truncate">{task.title}</span>
                        </div>
                      ))}
                      {viewMode !== 'day' && dayTasks.length > 3 && (
                        <div className="text-xs text-muted-foreground text-center">
                          +{dayTasks.length - 3} mais
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
