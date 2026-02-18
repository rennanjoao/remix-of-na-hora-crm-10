import { Mail, Search, TrendingUp, Users } from 'lucide-react';

interface ProspeccaoStatusBarProps {
  consultadasHoje: number;
  importadasHoje: number;
  emailsHoje: number;
}

export function ProspeccaoStatusBar({ consultadasHoje, importadasHoje, emailsHoje }: ProspeccaoStatusBarProps) {
  const taxa = consultadasHoje > 0 ? Math.round((importadasHoje / consultadasHoje) * 100) : 0;

  return (
    <div className="flex items-center gap-1 flex-wrap rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-md">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Consultas hoje:</span>
        <span className="text-xs font-semibold">{consultadasHoje}</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-md">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Leads importados:</span>
        <span className="text-xs font-semibold text-primary">{importadasHoje}</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-md">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Conversão:</span>
        <span className="text-xs font-semibold">{taxa}%</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-md">
        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">E-mails hoje:</span>
        <span className="text-xs font-semibold">{emailsHoje}</span>
      </div>
    </div>
  );
}
