import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { logLeadActivity } from '@/lib/lead-activities';
import { LeadActivityTimeline } from '@/components/leads/LeadActivityTimeline';
import {
  Loader2, Download, MoreVertical, Trash2, RotateCcw, Save, MessageSquare, Phone, Mail,
  Building2, MapPin, Video, Plus, Trash, Filter, X, Activity,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';
import { cn } from '@/lib/utils';
import {
  KANBAN_COLUMNS as COLUMNS,
  groupLeadsByColumn,
  type LeadStatus,
} from '@/lib/kanban-columns';

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
  updated_at: string;
  foto_url?: string | null;
  loss_reason?: string | null;
  bairro?: string | null;
}
type LeadExt = Lead & { nome_decisor?: string | null };

interface TimelineEntry {
  id: string; content: string; contact_type: string | null; created_at: string; author_id: string | null;
}

const CSV_COLUMNS: { header: string; get: (l: LeadExt) => string }[] = [
  { header: 'Empresa', get: l => l.nome_fantasia || l.razao_social || '' },
  { header: 'CNPJ', get: l => l.cnpj || '' },
  { header: 'Status', get: l => COLUMNS.find(c => c.id === l.status)?.label || l.status },
  { header: 'Telefone', get: l => l.telefone || '' },
  { header: 'Email', get: l => l.email || '' },
  { header: 'Nome do Decisor', get: l => l.nome_decisor || '' },
  { header: 'Endereço', get: l => [l.bairro, l.cidade, l.estado].filter(Boolean).join(', ') },
];

function toCSV(leads: LeadExt[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = CSV_COLUMNS.map(c => esc(c.header)).join(',');
  const rows = leads.map(l => CSV_COLUMNS.map(c => esc(c.get(l))).join(','));
  return '\uFEFF' + [header, ...rows].join('\n');
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const PAGE_SIZE = 50;
const LEAD_COLS =
  'id,cnpj,razao_social,nome_fantasia,telefone,email,cidade,estado,setor,status,created_at,updated_at,foto_url,loss_reason,bairro,nome_decisor';

export default function Leads() {
  const { profile, isAdmin, isSDR } = useAuth();
  const [leads, setLeads] = useState<LeadExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLead, setSelectedLead] = useState<LeadExt | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [newNote, setNewNote] = useState('');
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<LeadStatus | null>(null);
  const [tab, setTab] = useState<'pipeline' | 'descartados'>('pipeline');
  const [pipelinePage, setPipelinePage] = useState(0);
  const [discardedPage, setDiscardedPage] = useState(0);
  const [pipelineHasMore, setPipelineHasMore] = useState(true);
  const [discardedHasMore, setDiscardedHasMore] = useState(true);

  // Advanced filters
  const emptyFilters = { minRating: '', uf: '', cidade: '', setor: '', dateFrom: '', dateTo: '' };
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = Object.values(appliedFilters).filter(v => v && String(v).trim() !== '').length;

  // Edit form state
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDecisor, setEditDecisor] = useState('');
  const [saving, setSaving] = useState(false);

  const activeStatuses: LeadStatus[] = COLUMNS.map(c => c.id);

  const fetchLeadsPage = async (which: 'pipeline' | 'descartados', page: number, append: boolean, f = appliedFilters) => {
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase.from('leads').select(LEAD_COLS).order('updated_at', { ascending: false }).range(from, to);
      query = which === 'descartados'
        ? query.eq('status', 'perdido')
        : query.in('status', activeStatuses);
      if (f.minRating && !Number.isNaN(Number(f.minRating))) query = query.gte('rating', Number(f.minRating));
      if (f.uf.trim()) query = query.ilike('estado', f.uf.trim());
      if (f.cidade.trim()) query = query.ilike('cidade', `%${f.cidade.trim()}%`);
      if (f.setor.trim()) query = query.ilike('setor', `%${f.setor.trim()}%`);
      if (f.dateFrom) query = query.gte('created_at', f.dateFrom);
      if (f.dateTo) query = query.lte('created_at', `${f.dateTo}T23:59:59`);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data as unknown as LeadExt[]) || [];
      setLeads(prev => {
        if (!append) return rows;
        const merged = new Map(prev.map(l => [l.id, l]));
        for (const r of rows) merged.set(r.id, r);
        return Array.from(merged.values());
      });
      const hasMore = rows.length === PAGE_SIZE;
      if (which === 'pipeline') setPipelineHasMore(hasMore);
      else setDiscardedHasMore(hasMore);
    } catch (e) {
      console.error('Error fetching leads:', e);
      toast.error('Erro ao carregar leads', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  };

  const applyFilters = () => {
    setAppliedFilters(filters);
    setPipelinePage(0); setDiscardedPage(0);
    fetchLeadsPage(tab, 0, false, filters);
  };
  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPipelinePage(0); setDiscardedPage(0);
    fetchLeadsPage(tab, 0, false, emptyFilters);
  };

  const fetchTimeline = async (leadId: string) => {
    try {
      const { data, error } = await supabase.from('lead_timeline').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
      if (error) throw error;
      setTimeline(data || []);
    } catch (e) {
      console.error('Error fetching timeline:', e);
      toast.error('Erro ao carregar histórico', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    }
  };

  useEffect(() => {
    setPipelinePage(0); setDiscardedPage(0);
    fetchLeadsPage(tab, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const loadMore = () => {
    const nextPage = (tab === 'pipeline' ? pipelinePage : discardedPage) + 1;
    if (tab === 'pipeline') setPipelinePage(nextPage); else setDiscardedPage(nextPage);
    fetchLeadsPage(tab, nextPage, true);
  };

  const hasMore = tab === 'pipeline' ? pipelineHasMore : discardedHasMore;

  const activeLeads = useMemo(() => leads.filter(l => l.status !== 'perdido'), [leads]);
  const discardedLeads = useMemo(() => leads.filter(l => l.status === 'perdido'), [leads]);

  const { byColumn, orphans: orphanLeads } = useMemo(
    () => groupLeadsByColumn<LeadExt>(activeLeads, COLUMNS),
    [activeLeads],
  );

  const updateStatus = async (leadId: string, newStatus: LeadStatus, extra?: Partial<LeadExt>) => {
    try {
      const prev = leads.find(l => l.id === leadId);
      const patch = { status: newStatus, ...(extra || {}) };
      const { error } = await supabase.from('leads').update(patch as never).eq('id', leadId);
      if (error) throw error;
      setLeads(p => p.map(l => l.id === leadId ? { ...l, ...patch } as LeadExt : l));
      if (profile) {
        await logLeadActivity({
          leadId,
          userId: profile.id,
          actionType: 'status_change',
          description: `Status alterado de "${prev?.status ?? '—'}" para "${newStatus}"`,
          previousStatus: prev?.status ?? null,
          newStatus,
        });
      }
      toast.success('Status atualizado');
    } catch (e) {
      console.error('Error updating status:', e);
      toast.error('Erro ao atualizar status', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    }
  };

  const restoreLead = (id: string) => updateStatus(id, 'novo', { loss_reason: null });

  const openDetails = (lead: LeadExt) => {
    setSelectedLead(lead);
    setEditPhone(lead.telefone || '');
    setEditEmail(lead.email || '');
    setEditDecisor(lead.nome_decisor || '');
    setDetailsOpen(true);
    fetchTimeline(lead.id);
    if (profile) {
      logLeadActivity({
        leadId: lead.id,
        userId: profile.id,
        actionType: 'viewed',
        description: `Abriu o detalhe do lead ${lead.razao_social}`,
      });
    }
  };

  const saveEdits = async () => {
    if (!selectedLead) return;
    setSaving(true);
    try {
      const patch = { telefone: editPhone || null, email: editEmail || null, nome_decisor: editDecisor || null };
      const { error } = await supabase.from('leads').update(patch as never).eq('id', selectedLead.id);
      if (error) throw error;
      setLeads(p => p.map(l => l.id === selectedLead.id ? { ...l, ...patch } as LeadExt : l));
      setSelectedLead({ ...selectedLead, ...patch } as LeadExt);
      if (profile) {
        const changes: string[] = [];
        if (patch.telefone !== selectedLead.telefone) changes.push('telefone');
        if (patch.email !== selectedLead.email) changes.push('e-mail');
        if (patch.nome_decisor !== selectedLead.nome_decisor) changes.push('decisor');
        if (changes.length) {
          await logLeadActivity({
            leadId: selectedLead.id,
            userId: profile.id,
            actionType: 'field_updated',
            description: `Editou: ${changes.join(', ')}`,
            metadata: patch,
          });
        }
      }
      toast.success('Alterações salvas');
    } catch (e) {
      console.error('Error saving edits:', e);
      toast.error('Erro ao salvar', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!selectedLead || !newNote.trim() || !profile) return;
    try {
      const { error } = await supabase.from('lead_timeline').insert({
        lead_id: selectedLead.id, author_id: profile.id, content: newNote, contact_type: 'note',
      });
      if (error) throw error;
      await logLeadActivity({
        leadId: selectedLead.id,
        userId: profile.id,
        actionType: 'note_added',
        description: newNote.slice(0, 240),
      });
      setNewNote(''); fetchTimeline(selectedLead.id); toast.success('Nota adicionada');
    } catch (e) {
      console.error('Error adding note:', e);
      toast.error('Erro ao adicionar nota', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    }
  };

  const recordCallLead = async (lead: LeadExt) => {
    if (!profile || !lead.telefone) return;
    try {
      const { error } = await supabase.from('lead_timeline').insert({
        lead_id: lead.id,
        author_id: profile.id,
        content: `☎️ Ligação realizada para ${lead.telefone}`,
        contact_type: 'call',
      });
      if (error) throw error;
      await logLeadActivity({
        leadId: lead.id,
        userId: profile.id,
        actionType: 'call_made',
        description: `Ligação realizada para ${lead.telefone}`,
        metadata: { phone: lead.telefone },
      });
      fetchTimeline(lead.id);
    } catch (e) {
      console.error('Error recording call:', e);
      toast.error('Erro ao registrar ligação', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    }
  };

  // Drag & drop handlers
  const onDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggingId(leadId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
  };
  const onDragOverCol = (e: React.DragEvent, col: LeadStatus) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (hoverColumn !== col) setHoverColumn(col);
  };
  const onDropCol = (e: React.DragEvent, col: LeadStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null); setHoverColumn(null);
    if (!id) return;
    const lead = leads.find(l => l.id === id);
    if (lead && lead.status !== col) updateStatus(id, col);
  };

  const exportAll = () => downloadCSV(`leads_export_${Date.now()}.csv`, toCSV(activeLeads));
  const exportColumn = (col: LeadStatus) => {
    const list = byColumn.get(col) || [];
    const label = COLUMNS.find(c => c.id === col)?.label || col;
    downloadCSV(`leads_${label.toLowerCase().replace(/\s+/g,'_')}_${Date.now()}.csv`, toCSV(list));
  };

  if (loading) {
    return <DashboardLayout><div className="flex h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Pipeline de Leads</h1>
            <p className="text-muted-foreground mt-1 text-sm">Arraste os cards para mover entre estágios</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowFilters(v => !v)} className="gap-2">
              <Filter className="h-4 w-4" /> Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
            <Button variant="outline" onClick={exportAll} className="gap-2">
              <Download className="h-4 w-4" /> Exportar Todos (CSV)
            </Button>
          </div>
        </div>

        {showFilters && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div>
                  <Label className="text-xs">Rating mínimo</Label>
                  <Input type="number" step="0.1" min="0" max="5" placeholder="4.0"
                    value={filters.minRating}
                    onChange={e => setFilters(f => ({ ...f, minRating: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">UF</Label>
                  <Input placeholder="SP" maxLength={2}
                    value={filters.uf}
                    onChange={e => setFilters(f => ({ ...f, uf: e.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <Label className="text-xs">Cidade</Label>
                  <Input placeholder="Santos"
                    value={filters.cidade}
                    onChange={e => setFilters(f => ({ ...f, cidade: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Setor / CNAE</Label>
                  <Input placeholder="atacado, transporte..."
                    value={filters.setor}
                    onChange={e => setFilters(f => ({ ...f, setor: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Importado de</Label>
                  <Input type="date"
                    value={filters.dateFrom}
                    onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Importado até</Label>
                  <Input type="date"
                    value={filters.dateTo}
                    onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                    <X className="h-3.5 w-3.5" /> Limpar
                  </Button>
                )}
                <Button size="sm" onClick={applyFilters}>Aplicar filtros</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'pipeline' | 'descartados')} className="space-y-4">
          <TabsList>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="descartados" className="gap-1.5">
              <Trash className="h-3.5 w-3.5" /> Descartados
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline">
            {orphanLeads.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <strong>{orphanLeads.length}</strong> lead{orphanLeads.length > 1 ? 's' : ''} com status desconhecido não cabe{orphanLeads.length > 1 ? 'm' : ''} em nenhuma coluna do funil.
                Status encontrados: {[...new Set(orphanLeads.map(l => l.status))].join(', ')}.
                Ajuste o status desses leads para não ficarem invisíveis.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
              {COLUMNS.map(col => {
                const items = byColumn.get(col.id) || [];
                const isHover = hoverColumn === col.id;
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => onDragOverCol(e, col.id)}
                    onDragLeave={() => setHoverColumn(prev => prev === col.id ? null : prev)}
                    onDrop={(e) => onDropCol(e, col.id)}
                    className={cn(
                      'rounded-lg border border-border bg-muted/30 p-2 min-h-[400px] flex flex-col transition',
                      isHover && 'border-primary bg-primary/5'
                    )}
                  >
                    <div className="flex items-center justify-between px-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', col.badgeClass)}>{col.label}</span>
                        <span className="text-xs text-muted-foreground">{items.length}</span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-3.5 w-3.5" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => exportColumn(col.id)}>
                            <Download className="h-3.5 w-3.5 mr-2" /> Exportar esta Coluna
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="space-y-2 flex-1">
                      {items.map(lead => (
                        <Card
                          key={lead.id}
                          draggable
                          onDragStart={(e) => onDragStart(e, lead.id)}
                          onDragEnd={() => { setDraggingId(null); setHoverColumn(null); }}
                          onClick={() => openDetails(lead)}
                          className={cn(
                            'cursor-grab active:cursor-grabbing hover:border-primary/50 transition',
                            draggingId === lead.id && 'opacity-40'
                          )}
                        >
                          <CardContent className="p-2.5 space-y-1.5">
                            <div className="flex gap-2">
                              {lead.foto_url ? (
                                <img src={lead.foto_url} alt="" className="w-10 h-10 rounded object-cover shrink-0 border border-border"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0"><Building2 className="h-4 w-4 text-muted-foreground" /></div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium leading-tight truncate">{lead.nome_fantasia || lead.razao_social}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[lead.cidade, lead.estado].filter(Boolean).join('/')}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {lead.telefone && <span className="inline-flex items-center gap-0.5"><Phone className="h-3 w-3" /></span>}
                              {lead.email && <span className="inline-flex items-center gap-0.5"><Mail className="h-3 w-3" /></span>}
                              {!lead.telefone && !lead.email && <span className="italic">sem contato</span>}
                            </div>
                            <Select
                              value={lead.status}
                              onValueChange={(v: LeadStatus) => updateStatus(lead.id, v)}
                            >
                              <SelectTrigger className="h-7 text-xs" onClick={(e) => e.stopPropagation()}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {COLUMNS.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                                <SelectItem value="perdido">Descartar</SelectItem>
                              </SelectContent>
                            </Select>
                          </CardContent>
                        </Card>
                      ))}
                      {items.length === 0 && (
                        <div className="text-center py-6 text-xs text-muted-foreground italic">Vazio</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMore && tab === 'pipeline' && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Carregando...</> : 'Carregar mais resultados'}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="descartados">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {discardedLeads.length === 0 && (
                <div className="col-span-full text-center py-16 text-muted-foreground text-sm">
                  Nenhum lead descartado.
                </div>
              )}
              {discardedLeads.map(lead => (
                <Card key={lead.id} className="border-destructive/30">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{lead.nome_fantasia || lead.razao_social}</p>
                        <p className="text-xs text-muted-foreground truncate">{[lead.cidade, lead.estado].filter(Boolean).join('/')}</p>
                      </div>
                      <Trash2 className="h-4 w-4 text-destructive shrink-0" />
                    </div>
                    <div className="rounded-md bg-destructive/10 border border-destructive/20 px-2 py-1.5">
                      <p className="text-xs font-medium text-destructive">Motivo</p>
                      <p className="text-xs">{lead.loss_reason || 'Não informado'}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Descartado em {format(new Date(lead.updated_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                    </p>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => restoreLead(lead.id)}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar Lead
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            {hasMore && tab === 'descartados' && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Carregando...</> : 'Carregar mais resultados'}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Details / edit dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedLead?.razao_social}</DialogTitle>
              <DialogDescription>
                {selectedLead?.nome_fantasia && `${selectedLead.nome_fantasia} • `}
                CNPJ: {selectedLead?.cnpj || 'Não informado'}
              </DialogDescription>
            </DialogHeader>

            {selectedLead && (
              <div className="space-y-5 pt-2">
                {(isAdmin || isSDR) && (
                  <Button className="w-full" size="lg" onClick={() => setMeetingModalOpen(true)}>
                    <Video className="h-5 w-5 mr-2" /> Agendar Reunião
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/50">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div><p className="text-xs text-muted-foreground">Setor</p><p className="text-sm font-medium">{selectedLead.setor || '—'}</p></div>
                  </div>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/50">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <div><p className="text-xs text-muted-foreground">Local</p><p className="text-sm font-medium">{[selectedLead.cidade, selectedLead.estado].filter(Boolean).join('/') || '—'}</p></div>
                  </div>
                </div>

                {selectedLead.telefone && (
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a href={`tel:${selectedLead.telefone.replace(/\D/g, '') || selectedLead.telefone}`} onClick={() => { void recordCallLead(selectedLead); }}>
                      <Phone className="h-4 w-4 mr-2" /> Ligar e registrar atividade
                    </a>
                  </Button>
                )}

                {/* Quick edit form */}
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <h4 className="text-sm font-medium">Edição rápida</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><Label htmlFor="ph" className="text-xs">Telefone</Label><Input id="ph" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="11999999999" /></div>
                    <div><Label htmlFor="em" className="text-xs">Email</Label><Input id="em" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="contato@empresa.com" /></div>
                    <div className="md:col-span-2"><Label htmlFor="dc" className="text-xs">Nome do Decisor</Label><Input id="dc" value={editDecisor} onChange={e => setEditDecisor(e.target.value)} placeholder="ex: João Silva – Diretor Logística" /></div>
                  </div>
                  <Button onClick={saveEdits} disabled={saving} size="sm">
                    {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Salvando...</> : <><Save className="h-3.5 w-3.5 mr-1" />Salvar Alterações</>}
                  </Button>
                </div>

                {(isAdmin || isSDR) && (
                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2 text-sm"><MessageSquare className="h-4 w-4" /> Histórico</h4>
                    <Textarea placeholder="Adicionar nota..." value={newNote} onChange={e => setNewNote(e.target.value)} className="min-h-[70px]" />
                    <Button onClick={addNote} disabled={!newNote.trim()} size="sm"><Plus className="h-3.5 w-3.5 mr-1" />Adicionar Nota</Button>
                    <div className="space-y-2">
                      {timeline.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">Sem notas ainda</p>
                      ) : timeline.map(entry => (
                        <div key={entry.id} className={cn('p-2.5 rounded-lg border bg-card', entry.contact_type === 'meeting' && 'border-primary/30 bg-primary/5')}>
                          <p className="text-sm">{entry.content}</p>
                          <p className="text-xs text-muted-foreground mt-1.5">{format(new Date(entry.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedLead && (
                  <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4" /> Histórico de Atividades
                    </h4>
                    <LeadActivityTimeline leadId={selectedLead.id} />
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ScheduleMeetingModal
          open={meetingModalOpen}
          onOpenChange={setMeetingModalOpen}
          lead={selectedLead}
          onMeetingCreated={() => { if (selectedLead) fetchTimeline(selectedLead.id); }}
        />
      </div>
    </DashboardLayout>
  );
}
