import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, RotateCcw, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { logLeadActivity } from '@/lib/lead-activities';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const OUTCOME_LABEL: Record<string, string> = {
  nao_usa_servico: 'Não usava o serviço',
  frota_propria: 'Tinha frota própria',
  pediu_apresentacao: 'Pediu apresentação',
  sem_interesse_momento: 'Sem interesse no momento',
  sem_resposta: 'Sem resposta',
  decisor_apresentado: 'Decisor apresentado',
};

interface ReactivateLead {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  contact_outcome: string | null;
  loss_reason: string | null;
  next_contact_date: string | null;
  updated_at: string;
}

export function ReactivationList() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<ReactivateLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.rpc as any)('leads_para_reativar');
    setLeads((data as ReactivateLead[] | null) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (lead: ReactivateLead) => {
    if (!profile) return;
    setRestoring(lead.id);
    try {
      const { error } = await supabase.from('leads').update({
        status: 'novo',
        is_suppressed: false,
        next_contact_date: null,
      } as never).eq('id', lead.id);
      if (error) throw error;

      const prev = lead.contact_outcome ? OUTCOME_LABEL[lead.contact_outcome] || lead.contact_outcome : 'sem outcome';
      await supabase.from('lead_timeline').insert({
        lead_id: lead.id,
        author_id: profile.id,
        content: `♻️ Lead reativado (outcome anterior: ${prev}${lead.loss_reason ? ` — ${lead.loss_reason}` : ''})`,
        contact_type: 'reactivation',
      });

      toast.success('Lead reaberto — foi para o funil como Novo');
      setLeads(l => l.filter(x => x.id !== lead.id));
    } catch (err) {
      console.error(err);
      toast.error('Erro ao reabrir lead');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Leads para reativar hoje
          {leads.length > 0 && <Badge variant="secondary">{leads.length}</Badge>}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Nenhum lead pronto para reativação hoje.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {leads.map(lead => {
              const label = lead.contact_outcome ? OUTCOME_LABEL[lead.contact_outcome] : null;
              const since = formatDistanceToNow(new Date(lead.updated_at), { locale: ptBR, addSuffix: false });
              return (
                <div key={lead.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 hover:bg-accent/40 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium truncate">{lead.nome_fantasia || lead.razao_social}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {label || 'Descartado'}{lead.loss_reason ? ` • ${lead.loss_reason}` : ''} • suprimido há {since}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => restore(lead)} disabled={restoring === lead.id}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reabrir
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
