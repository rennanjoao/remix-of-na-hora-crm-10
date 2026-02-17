import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { classificarCNAE, SETOR_CONFIG } from '@/lib/cnae-classifier';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckCircle, Clock } from 'lucide-react';

interface Consulta {
  id: string;
  cnpj: string;
  razao_social: string | null;
  cnae_codigo: string | null;
  cidade: string | null;
  estado: string | null;
  importado: boolean | null;
  created_at: string;
}

interface ConsultaHistoryTableProps {
  consultas: Consulta[];
}

export function ConsultaHistoryTable({ consultas }: ConsultaHistoryTableProps) {
  if (consultas.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">Nenhuma consulta realizada ainda.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Empresa</TableHead>
          <TableHead>CNPJ</TableHead>
          <TableHead>Setor</TableHead>
          <TableHead>Local</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Data</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {consultas.map((c) => {
          const setor = classificarCNAE(c.cnae_codigo || '');
          const config = SETOR_CONFIG[setor];
          return (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.razao_social || '—'}</TableCell>
              <TableCell className="font-mono text-xs">{c.cnpj}</TableCell>
              <TableCell><Badge className={config.color}>{config.label}</Badge></TableCell>
              <TableCell className="text-sm">{c.cidade && c.estado ? `${c.cidade}/${c.estado}` : '—'}</TableCell>
              <TableCell>
                {c.importado ? (
                  <Badge variant="default" className="gap-1"><CheckCircle className="h-3 w-3" />Importado</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Consultado</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(c.created_at), "dd/MM HH:mm", { locale: ptBR })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
