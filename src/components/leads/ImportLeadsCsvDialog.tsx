import { useState } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';

type FieldKey =
  | 'razao_social' | 'nome_fantasia' | 'cnpj' | 'telefone' | 'email'
  | 'cidade' | 'estado' | 'setor' | 'website' | 'nome_decisor';

const FIELDS: { key: FieldKey; label: string; required?: boolean }[] = [
  { key: 'razao_social', label: 'Empresa / Razão social', required: true },
  { key: 'nome_fantasia', label: 'Nome fantasia' },
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'estado', label: 'UF' },
  { key: 'setor', label: 'Setor' },
  { key: 'website', label: 'Website' },
  { key: 'nome_decisor', label: 'Nome do decisor' },
];

const NONE = '__none__';

function guess(header: string, key: FieldKey): boolean {
  const h = header.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const map: Record<FieldKey, string[]> = {
    razao_social: ['razao', 'empresa', 'nome', 'company'],
    nome_fantasia: ['fantasia', 'trade'],
    cnpj: ['cnpj', 'documento'],
    telefone: ['telefone', 'fone', 'phone', 'celular', 'whats'],
    email: ['email', 'e-mail', 'mail'],
    cidade: ['cidade', 'municipio', 'city'],
    estado: ['estado', 'uf', 'state'],
    setor: ['setor', 'segmento', 'cnae', 'categoria'],
    website: ['site', 'website', 'url'],
    nome_decisor: ['decisor', 'contato', 'responsavel'],
  };
  return map[key].some(t => h.includes(t));
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');

interface Props {
  onImported: () => void;
}

export function ImportLeadsCsvDialog({ onImported }: Props) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = () => { setHeaders([]); setRows([]); setMapping({}); setProgress(null); };

  const handleFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        if (hs.length === 0) { toast.error('CSV sem cabeçalho reconhecível'); return; }
        setHeaders(hs);
        setRows(res.data);
        const auto: Partial<Record<FieldKey, string>> = {};
        for (const f of FIELDS) {
          const match = hs.find(h => guess(h, f.key));
          if (match) auto[f.key] = match;
        }
        setMapping(auto);
      },
      error: (err) => {
        console.error('CSV parse error:', err);
        toast.error('Erro ao ler o CSV', { description: err.message });
      },
    });
  };

  const runImport = async () => {
    if (!profile) return;
    const nameCol = mapping.razao_social;
    if (!nameCol) { toast.error('Mapeie a coluna de Empresa / Razão social'); return; }

    setImporting(true);
    try {
      const candidates = rows.map(r => {
        const val = (key: FieldKey) => {
          const col = mapping[key];
          const raw = col ? (r[col] ?? '') : '';
          return raw.trim() || null;
        };
        const razao = val('razao_social');
        if (!razao) return null;
        return {
          razao_social: razao,
          nome_fantasia: val('nome_fantasia'),
          cnpj: val('cnpj') ? onlyDigits(val('cnpj') as string) : null,
          telefone: val('telefone'),
          email: val('email')?.toLowerCase() ?? null,
          cidade: val('cidade'),
          estado: val('estado')?.toUpperCase().slice(0, 2) ?? null,
          setor: val('setor'),
          website: val('website'),
          nome_decisor: val('nome_decisor'),
          status: 'novo' as const,
          fonte: 'csv_import',
          created_by: profile.id,
          assigned_to: profile.id,
        };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      if (candidates.length === 0) { toast.error('Nenhuma linha válida no arquivo'); return; }

      // Deduplicação: dentro do próprio arquivo e contra o que já existe no banco.
      const seen = new Set<string>();
      const deduped = candidates.filter(c => {
        const key = c.cnpj || (c.telefone ? onlyDigits(c.telefone).slice(-11) : '') || c.email || c.razao_social.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const cnpjs = deduped.map(c => c.cnpj).filter(Boolean) as string[];
      const emails = deduped.map(c => c.email).filter(Boolean) as string[];
      const existing = new Set<string>();
      if (cnpjs.length) {
        const { data } = await supabase.from('leads').select('cnpj').in('cnpj', cnpjs);
        (data ?? []).forEach(d => d.cnpj && existing.add(d.cnpj));
      }
      if (emails.length) {
        const { data } = await supabase.from('leads').select('email').in('email', emails);
        (data ?? []).forEach(d => d.email && existing.add(d.email.toLowerCase()));
      }

      const toInsert = deduped.filter(c => !(c.cnpj && existing.has(c.cnpj)) && !(c.email && existing.has(c.email)));
      const skipped = deduped.length - toInsert.length;

      if (toInsert.length === 0) {
        toast.info('Todos os leads do arquivo já existem no CRM');
        return;
      }

      let inserted = 0;
      const CHUNK = 100;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        setProgress({ done: i, total: toInsert.length });
        const { error } = await supabase.from('leads').insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }

      toast.success(`${inserted} leads importados`, {
        description: skipped > 0 ? `${skipped} ignorados por duplicidade` : undefined,
      });
      setOpen(false); reset(); onImported();
    } catch (e) {
      console.error('Error importing CSV:', e);
      toast.error('Erro ao importar leads', { description: e instanceof Error ? e.message : 'Erro desconhecido' });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Importar CSV
      </Button>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar leads de CSV</DialogTitle>
          <DialogDescription>
            Selecione o arquivo e confira o mapeamento das colunas. Duplicatas por CNPJ ou e-mail são ignoradas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="csv-file" className="text-xs">Arquivo CSV</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {headers.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {rows.length} linhas encontradas. Ajuste o mapeamento se necessário.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FIELDS.map(f => (
                  <div key={f.key}>
                    <Label className="text-xs">
                      {f.label}{f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Select
                      value={mapping[f.key] ?? NONE}
                      onValueChange={(v) => setMapping(m => ({ ...m, [f.key]: v === NONE ? undefined : v }))}
                    >
                      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Não importar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Não importar</SelectItem>
                        {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={runImport} disabled={importing || headers.length === 0}>
            {importing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{progress ? `Importando ${progress.done}/${progress.total}...` : 'Importando...'}</>
              : 'Importar leads'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
