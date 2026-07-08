import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Activity, ArrowRightLeft, StickyNote, Mail, Phone, Eye, Video,
  UserPlus, Download, MessageCircle, Send, Pencil, Loader2,
} from 'lucide-react';
import type { LeadActivityType } from '@/lib/lead-activities';

interface Row {
  id: string;
  action_type: LeadActivityType;
  description: string;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;
  user_id: string | null;
  profiles?: { full_name: string | null } | null;
}

const META: Record<LeadActivityType, { icon: typeof Activity; className: string; label: string }> = {
  status_change:     { icon: ArrowRightLeft, className: 'bg-purple-500/10 text-purple-600', label: 'Status' },
  note_added:        { icon: StickyNote,     className: 'bg-amber-500/10 text-amber-600',   label: 'Nota' },
  email_sent:        { icon: Mail,           className: 'bg-orange-500/10 text-orange-600', label: 'E-mail' },
  call_made:         { icon: Phone,          className: 'bg-teal-500/10 text-teal-600',     label: 'Ligação' },
  viewed:            { icon: Eye,            className: 'bg-slate-500/10 text-slate-600',   label: 'Visualizou' },
  meeting_scheduled: { icon: Video,          className: 'bg-emerald-500/10 text-emerald-600', label: 'Reunião' },
  lead_created:      { icon: UserPlus,       className: 'bg-blue-500/10 text-blue-600',     label: 'Criado' },
  lead_imported:     { icon: Download,       className: 'bg-blue-500/10 text-blue-600',     label: 'Importado' },
  whatsapp_sent:     { icon: MessageCircle,  className: 'bg-green-500/10 text-green-600',   label: 'WhatsApp' },
  campaign_enrolled: { icon: Send,           className: 'bg-indigo-500/10 text-indigo-600', label: 'Cadência' },
  field_updated:     { icon: Pencil,         className: 'bg-slate-500/10 text-slate-600',   label: 'Edição' },
};

const STATUS_LABELS: Record<string, string> = {
  novo: 'Novo',
  contato: 'Enriquecido',
  qualificado: 'Email Enviado',
  proposta: 'Proposta',
  negociacao: 'Conversando',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

function activityTime(row: Row): number {
  const time = Date.parse(row.created_at);
  return Number.isNaN(time) ? 0 : time;
}

function sortActivities(items: Row[]): Row[] {
  return [...items].sort((a, b) => activityTime(b) - activityTime(a) || b.id.localeCompare(a.id));
}

function statusLabel(status: string | null): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

function descriptionFor(row: Row): string {
  if (row.action_type === 'status_change' && (row.previous_status || row.new_status)) {
    if (/^status\s+alterado/i.test(row.description)) return 'Status alterado';
  }
  return row.description;
}

interface Props { leadId: string }

export function LeadActivityTimeline({ leadId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await (supabase.from as unknown as (t: string) => {
        select: (cols: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => Promise<{ data: Row[] | null }>;
          };
        };
      })('lead_activities')
        .select('id, action_type, description, previous_status, new_status, created_at, user_id, profiles:user_id (full_name)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });
      if (!active) return;
      setRows(sortActivities(data ?? []));
      setLoading(false);
    })();

    // Realtime: novas atividades
    const channel = supabase
      .channel(`lead-activities-${leadId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lead_activities', filter: `lead_id=eq.${leadId}` },
        (payload) => {
          const row = payload.new as Row;
          setRows(prev => sortActivities([row, ...prev.filter(item => item.id !== row.id)]));
        }
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [leadId]);

  if (loading) {
    return <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-6">Sem atividades registradas para este lead.</p>;
  }

  const sortedRows = useMemo(() => sortActivities(rows), [rows]);

  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
      <ul className="space-y-3">
        {sortedRows.map(r => {
          const meta = META[r.action_type] ?? META.viewed;
          const Icon = meta.icon;
          const hasStatusChange = r.action_type === 'status_change' && (r.previous_status || r.new_status);
          return (
            <li key={r.id} className="relative">
              <div className={`absolute -left-6 top-0.5 h-5 w-5 rounded-full ring-2 ring-background flex items-center justify-center ${meta.className}`}>
                <Icon className="h-3 w-3" />
              </div>
              <div className="rounded-md border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(r.created_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}
                  </span>
                </div>
                <p className="text-sm mt-0.5">{descriptionFor(r)}</p>
                {hasStatusChange && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-md border bg-muted px-2 py-0.5 text-muted-foreground">
                      De: {statusLabel(r.previous_status)}
                    </span>
                    <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded-md border bg-card px-2 py-0.5 font-medium text-foreground">
                      Para: {statusLabel(r.new_status)}
                    </span>
                  </div>
                )}
                {r.profiles?.full_name && (
                  <p className="text-[10px] text-muted-foreground mt-1">por {r.profiles.full_name}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
