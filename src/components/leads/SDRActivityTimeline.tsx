import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Activity, Phone, Mail, MessageCircle, Eye, Edit3, Flag, UserPlus, Download, CalendarPlus, Sparkles, Loader2, type LucideIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Activity {
  id: string;
  lead_id: string;
  user_id: string | null;
  action_type: string;
  description: string;
  previous_status: string | null;
  new_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  lead?: { razao_social: string | null; nome_fantasia: string | null } | null;
}

const ICONS: Record<string, LucideIcon> = {
  call_made: Phone,
  email_sent: Mail,
  whatsapp_sent: MessageCircle,
  viewed: Eye,
  note_added: Edit3,
  status_change: Flag,
  lead_created: UserPlus,
  lead_imported: Download,
  meeting_scheduled: CalendarPlus,
  campaign_enrolled: Sparkles,
  field_updated: Edit3,
};

interface Props {
  sdrId: string | null;
  since: Date;
  until?: Date;
  actionType?: string | null;
}

export function SDRActivityTimeline({ sdrId, since, until, actionType }: Props) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase.from('lead_activities')
        .select('*, lead:leads(razao_social, nome_fantasia)')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(500);
      if (until) q = q.lte('created_at', until.toISOString());
      if (sdrId) q = q.eq('user_id', sdrId);
      if (actionType) q = q.eq('action_type', actionType);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error(error);
      setItems((data ?? []) as Activity[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sdrId, since.getTime(), until?.getTime(), actionType]);

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">Sem atividades neste período.</p>;

  return (
    <div className="space-y-2">
      {items.map(it => {
        const Icon = ICONS[it.action_type] ?? Activity;
        const company = it.lead?.nome_fantasia || it.lead?.razao_social || '—';
        return (
          <Card key={it.id} className="border-l-4 border-l-primary/40">
            <CardContent className="p-3 flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10 text-primary shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-tight truncate">{company}</p>
                  <time className="text-[11px] text-muted-foreground shrink-0">
                    {format(new Date(it.created_at), "dd/MM HH:mm", { locale: ptBR })}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">{it.description}</p>
                {it.previous_status && it.new_status && (
                  <div className="mt-1 flex items-center gap-1 text-[10px]">
                    <Badge variant="outline">{it.previous_status}</Badge>
                    <span>→</span>
                    <Badge>{it.new_status}</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
