import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, GitMerge, RefreshCw } from 'lucide-react';

interface Pair {
  lead_a_id: string | null;
  lead_a_name: string | null;
  lead_b_id: string | null;
  lead_b_name: string | null;
  match_type: string | null;
}

const MATCH_LABEL: Record<string, string> = {
  cnpj: 'Mesmo CNPJ',
  telefone: 'Mesmo telefone',
  email_domain: 'Mesmo domínio de e-mail',
  email: 'Mesmo e-mail',
};

export function DuplicateLeadsManager() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  const fetchPairs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('duplicate_lead_candidates')
        .select('*')
        .limit(200);
      if (error) throw error;
      setPairs(data ?? []);
    } catch (e) {
      console.error('Error loading duplicates:', e);
      toast.error('Erro ao carregar duplicatas', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchPairs(); }, []);

  const merge = async (winner: string, loser: string, key: string) => {
    setMergingKey(key);
    try {
      const { error } = await supabase.rpc('merge_leads', { _winner: winner, _loser: loser });
      if (error) throw error;
      toast.success('Leads mesclados');
      setPairs(prev => prev.filter(p => `${p.lead_a_id}-${p.lead_b_id}` !== key));
    } catch (e) {
      console.error('Error merging leads:', e);
      toast.error('Erro ao mesclar', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setMergingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" /> Duplicatas de Leads
          </CardTitle>
          <CardDescription>
            Pares suspeitos por CNPJ, telefone ou e-mail. Ao mesclar, todo o histórico vai para o lead mantido e o outro é suprimido.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPairs} disabled={loading} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : pairs.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma duplicata detectada. Importações novas são checadas automaticamente por CNPJ, telefone e place_id.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead A</TableHead>
                <TableHead>Lead B</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Mesclar mantendo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.map(p => {
                const key = `${p.lead_a_id}-${p.lead_b_id}`;
                const busy = mergingKey === key;
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{p.lead_a_name || '—'}</TableCell>
                    <TableCell className="font-medium">{p.lead_b_name || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{MATCH_LABEL[p.match_type ?? ''] ?? p.match_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm" variant="outline" disabled={busy || !p.lead_a_id || !p.lead_b_id}
                        onClick={() => p.lead_a_id && p.lead_b_id && merge(p.lead_a_id, p.lead_b_id, key)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Lead A'}
                      </Button>
                      <Button
                        size="sm" variant="outline" disabled={busy || !p.lead_a_id || !p.lead_b_id}
                        onClick={() => p.lead_a_id && p.lead_b_id && merge(p.lead_b_id, p.lead_a_id, key)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Lead B'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
