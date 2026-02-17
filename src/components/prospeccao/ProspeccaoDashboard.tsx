import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, UserPlus, TrendingUp } from 'lucide-react';

interface ProspeccaoDashboardProps {
  consultadasHoje: number;
  importadasHoje: number;
}

export function ProspeccaoDashboard({ consultadasHoje, importadasHoje }: ProspeccaoDashboardProps) {
  const taxa = consultadasHoje > 0 ? Math.round((importadasHoje / consultadasHoje) * 100) : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Search className="h-4 w-4" />
            Consultadas Hoje
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{consultadasHoje}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Convertidas em Leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{importadasHoje}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Taxa de Conversão
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{taxa}%</p>
        </CardContent>
      </Card>
    </div>
  );
}
