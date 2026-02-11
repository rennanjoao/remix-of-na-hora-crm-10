import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Target, Search, Plus, MessageSquare, Phone, Mail, Building2, MapPin, Video } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';
import { cn } from '@/lib/utils';

type LeadStatus = 'novo' | 'contato' | 'qualificado' | 'proposta' | 'negociacao' | 'ganho' | 'perdido';

interface Lead {
  id: string;
  cnpj: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  setor: string | null;
  status: LeadStatus;
  created_at: string;
}

interface TimelineEntry {
  id: string;
  content: string;
  contact_type: string;
  created_at: string;
  author_id: string;
}

export default function Leads() {
  const { profile, isAdmin, isSDR } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [newNote, setNewNote] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast.error('Erro ao carregar leads');
    } finally {
      setLoading(false);
    }
  };

  const fetchTimeline = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('lead_timeline')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTimeline(data || []);
    } catch (error) {
      console.error('Error fetching timeline:', error);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const updateLeadStatus = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: newStatus })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev => prev.map(l => 
        l.id === leadId ? { ...l, status: newStatus } : l
      ));
      toast.success('Status atualizado');
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Erro ao atualizar status');
    }
  };

  const addTimelineNote = async () => {
    if (!selectedLead || !newNote.trim() || !profile) return;

    try {
      const { error } = await supabase
        .from('lead_timeline')
        .insert({
          lead_id: selectedLead.id,
          author_id: profile.id,
          content: newNote,
          contact_type: 'note',
        });

      if (error) throw error;

      toast.success('Nota adicionada');
      setNewNote('');
      fetchTimeline(selectedLead.id);
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Erro ao adicionar nota');
    }
  };

  const openLeadDetails = (lead: Lead) => {
    setSelectedLead(lead);
    setDetailsOpen(true);
    fetchTimeline(lead.id);
  };

  const filteredLeads = leads.filter(lead => {
    const matchesSearch = 
      lead.razao_social.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.cnpj?.includes(searchTerm) ||
      lead.cidade?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: LeadStatus) => {
    const variants: Record<LeadStatus, string> = {
      novo: 'status-novo',
      contato: 'status-contato',
      qualificado: 'status-qualificado',
      proposta: 'status-proposta',
      negociacao: 'status-negociacao',
      ganho: 'status-ganho',
      perdido: 'status-perdido',
    };
    const labels: Record<LeadStatus, string> = {
      novo: 'Novo',
      contato: 'Contato',
      qualificado: 'Qualificado',
      proposta: 'Proposta',
      negociacao: 'Negociação',
      ganho: 'Ganho',
      perdido: 'Perdido',
    };
    return <span className={`status-badge ${variants[status]}`}>{labels[status]}</span>;
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">Leads</h1>
            <p className="text-muted-foreground mt-1">
              Gerencie seus leads e oportunidades de negócio
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Lista de Leads
                </CardTitle>
                <CardDescription>{filteredLeads.length} leads encontrados</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar leads..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="contato">Contato</SelectItem>
                    <SelectItem value="qualificado">Qualificado</SelectItem>
                    <SelectItem value="proposta">Proposta</SelectItem>
                    <SelectItem value="negociacao">Negociação</SelectItem>
                    <SelectItem value="ganho">Ganho</SelectItem>
                    <SelectItem value="perdido">Perdido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Cidade/UF</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{lead.razao_social}</p>
                        {lead.nome_fantasia && (
                          <p className="text-sm text-muted-foreground">{lead.nome_fantasia}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{lead.cnpj || '-'}</TableCell>
                    <TableCell>
                      {lead.cidade && lead.estado ? `${lead.cidade}/${lead.estado}` : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {lead.telefone && <Phone className="h-4 w-4 text-muted-foreground" />}
                        {lead.email && <Mail className="h-4 w-4 text-muted-foreground" />}
                        {!lead.telefone && !lead.email && '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={lead.status}
                        onValueChange={(value: LeadStatus) => updateLeadStatus(lead.id, value)}
                        disabled={!isAdmin && !isSDR}
                      >
                        <SelectTrigger className="w-32 border-0 bg-transparent p-0">
                          <SelectValue>{getStatusBadge(lead.status)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="novo">Novo</SelectItem>
                          <SelectItem value="contato">Contato</SelectItem>
                          <SelectItem value="qualificado">Qualificado</SelectItem>
                          <SelectItem value="proposta">Proposta</SelectItem>
                          <SelectItem value="negociacao">Negociação</SelectItem>
                          <SelectItem value="ganho">Ganho</SelectItem>
                          <SelectItem value="perdido">Perdido</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => openLeadDetails(lead)}
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Detalhes
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredLeads.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                Nenhum lead encontrado
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedLead?.razao_social}</DialogTitle>
              <DialogDescription>
                {selectedLead?.nome_fantasia && `${selectedLead.nome_fantasia} • `}
                CNPJ: {selectedLead?.cnpj || 'Não informado'}
              </DialogDescription>
            </DialogHeader>
            
            {selectedLead && (
              <div className="space-y-6 pt-4">
                {/* Schedule Meeting Button */}
                {(isAdmin || isSDR) && (
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => {
                      setMeetingModalOpen(true);
                    }}
                  >
                    <Video className="h-5 w-5 mr-2" />
                    Agendar Reunião
                  </Button>
                )}

                {/* Info Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Setor</p>
                      <p className="text-sm font-medium">{selectedLead.setor || 'Não informado'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Localização</p>
                      <p className="text-sm font-medium">
                        {selectedLead.cidade && selectedLead.estado 
                          ? `${selectedLead.cidade}/${selectedLead.estado}` 
                          : 'Não informado'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <Phone className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Telefone</p>
                      <p className="text-sm font-medium">{selectedLead.telefone || 'Não informado'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">E-mail</p>
                      <p className="text-sm font-medium">{selectedLead.email || 'Não informado'}</p>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                {(isAdmin || isSDR) && (
                  <div className="space-y-4">
                    <h4 className="font-medium flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Histórico de Contato
                    </h4>

                    {/* Add Note */}
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Adicionar nota sobre este lead..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        className="min-h-[80px]"
                      />
                    </div>
                    <Button 
                      onClick={addTimelineNote} 
                      disabled={!newNote.trim()}
                      size="sm"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Adicionar Nota
                    </Button>

                    {/* Timeline List */}
                    <div className="space-y-3 mt-4">
                      {timeline.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Nenhuma nota registrada ainda
                        </p>
                      ) : (
                        timeline.map((entry) => (
                          <div key={entry.id} className={cn(
                            "p-3 rounded-lg border bg-card",
                            entry.contact_type === 'meeting' && "border-primary/30 bg-primary/5"
                          )}>
                            <p className="text-sm">{entry.content}</p>
                            <p className="text-xs text-muted-foreground mt-2">
                              {format(new Date(entry.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Schedule Meeting Modal */}
        <ScheduleMeetingModal
          open={meetingModalOpen}
          onOpenChange={setMeetingModalOpen}
          lead={selectedLead}
          onMeetingCreated={() => {
            if (selectedLead) fetchTimeline(selectedLead.id);
          }}
        />
      </div>
    </DashboardLayout>
  );
}
