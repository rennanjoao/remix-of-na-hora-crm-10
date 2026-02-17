import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Upload, Play, Pause, Download, Filter, MapPin, Building2, CheckCircle, XCircle, Loader2, Pickaxe, AlertTriangle } from 'lucide-react';
import { BrasilAPICompany } from '@/hooks/useBrasilAPI';
import { classificarCNAE, SETOR_CONFIG, isAltoPotencialLogistica } from '@/lib/cnae-classifier';
import { NICHE_FILTERS, PORTE_OPTIONS, UF_OPTIONS, matchCargoProfiles, CARGO_PROFILES, getProfileSummary } from '@/lib/cnae-profiles';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface EnrichedCompany {
  cnpj: string;
  data: BrasilAPICompany | null;
  status: 'pending' | 'loading' | 'success' | 'error';
  error?: string;
  selected: boolean;
}

const DELAY_MS = 2000;

export function MiningMode() {
  const { profile } = useAuth();
  const [companies, setCompanies] = useState<EnrichedCompany[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [importing, setImporting] = useState(false);
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [filterNiche, setFilterNiche] = useState<string>('all');
  const [filterUF, setFilterUF] = useState<string>('all');
  const [filterCidade, setFilterCidade] = useState('');
  const [filterBairro, setFilterBairro] = useState('');
  const [filterPorte, setFilterPorte] = useState<string>('all');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/[\r\n]+/).filter(Boolean);

      // Parse CNPJs - skip header if present
      const cnpjs: string[] = [];
      for (const line of lines) {
        // Extract digits from each line (handles CSV with multiple columns)
        const parts = line.split(/[,;\t]/);
        for (const part of parts) {
          const digits = part.replace(/\D/g, '');
          if (digits.length === 14 && !cnpjs.includes(digits)) {
            cnpjs.push(digits);
          }
        }
      }

      if (cnpjs.length === 0) {
        toast.error('Nenhum CNPJ válido (14 dígitos) encontrado no arquivo');
        return;
      }

      setCompanies(cnpjs.map(cnpj => ({ cnpj, data: null, status: 'pending', selected: false })));
      setCurrentIndex(0);
      toast.success(`${cnpjs.length} CNPJs carregados. Clique "Iniciar Enriquecimento" para processar.`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const processQueue = useCallback(async () => {
    setProcessing(true);
    abortRef.current = false;

    for (let i = currentIndex; i < companies.length; i++) {
      if (abortRef.current) break;
      if (companies[i].status === 'success') {
        setCurrentIndex(i + 1);
        continue;
      }

      setCompanies(prev => prev.map((c, idx) => idx === i ? { ...c, status: 'loading' } : c));
      setCurrentIndex(i);

      try {
        const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${companies[i].cnpj}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'Não encontrado' : `Erro ${res.status}`);
        const data: BrasilAPICompany = await res.json();
        setCompanies(prev => prev.map((c, idx) => idx === i ? { ...c, data, status: 'success' } : c));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro';
        setCompanies(prev => prev.map((c, idx) => idx === i ? { ...c, status: 'error', error: msg } : c));
      }

      // Wait between requests
      if (i < companies.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    setProcessing(false);
  }, [companies, currentIndex]);

  const pauseProcessing = () => {
    abortRef.current = true;
  };

  const toggleSelect = (idx: number) => {
    setCompanies(prev => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c));
  };

  const selectAllFiltered = (checked: boolean) => {
    const filteredIds = new Set(filtered.map(c => c.cnpj));
    setCompanies(prev => prev.map(c =>
      c.status === 'success' && filteredIds.has(c.cnpj) ? { ...c, selected: checked } : c
    ));
  };

  // Apply filters
  const filtered = companies.filter(c => {
    if (c.status !== 'success' || !c.data) return false;
    const d = c.data;
    const cnaeCode = String(d.cnae_fiscal);

    if (filterNiche !== 'all') {
      const niche = NICHE_FILTERS.find(n => n.label === filterNiche);
      if (niche && !niche.prefixes.some(p => cnaeCode.startsWith(p))) return false;
    }
    if (filterUF !== 'all' && d.uf !== filterUF) return false;
    if (filterCidade && !d.municipio.toLowerCase().includes(filterCidade.toLowerCase())) return false;
    if (filterBairro && !(d.bairro || '').toLowerCase().includes(filterBairro.toLowerCase())) return false;
    if (filterPorte !== 'all') {
      const porte = (d.porte || '').toUpperCase();
      if (filterPorte === 'MEI' && !porte.includes('MEI')) return false;
      if (filterPorte === 'ME' && !porte.includes('MICRO') && !porte.includes(' ME')) return false;
      if (filterPorte === 'EPP' && !porte.includes('PEQUENO')) return false;
      if (filterPorte === 'DEMAIS' && (porte.includes('MEI') || porte.includes('MICRO') || porte.includes('PEQUENO'))) return false;
    }
    return true;
  });

  const selectedCount = filtered.filter(c => c.selected).length;
  const successCount = companies.filter(c => c.status === 'success').length;
  const errorCount = companies.filter(c => c.status === 'error').length;
  const progress = companies.length > 0 ? Math.round(((successCount + errorCount) / companies.length) * 100) : 0;

  // Profile summary
  const profileSummary = getProfileSummary(
    filtered.map(c => ({ cnae_codigo: c.data ? String(c.data.cnae_fiscal) : null }))
  );

  const handleBulkImport = async () => {
    if (!profile) return;
    const toImport = filtered.filter(c => c.selected && c.data);
    if (toImport.length === 0) return;

    setImporting(true);
    let imported = 0;
    let skipped = 0;

    try {
      for (const item of toImport) {
        const d = item.data!;
        const cnpjClean = d.cnpj.replace(/\D/g, '');

        // Check existing
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('cnpj', cnpjClean)
          .maybeSingle();

        if (existing) { skipped++; continue; }

        const { error } = await supabase.from('leads').insert({
          cnpj: cnpjClean,
          razao_social: d.razao_social,
          nome_fantasia: d.nome_fantasia,
          telefone: d.ddd_telefone_1 || d.ddd_telefone_2,
          email: d.email,
          cidade: d.municipio,
          estado: d.uf,
          cnae_codigo: String(d.cnae_fiscal),
          cnae_descricao: d.cnae_fiscal_descricao,
          setor: d.cnae_fiscal_descricao,
          created_by: profile.id,
          assigned_to: profile.id,
          status: 'novo',
          fonte: 'Mineração em Massa',
        });

        if (!error) imported++;
      }

      // Also save to cnpj_consultas
      const consultasToInsert = toImport
        .filter(i => i.data)
        .map(i => {
          const d = i.data!;
          return {
            cnpj: d.cnpj.replace(/\D/g, ''),
            razao_social: d.razao_social,
            nome_fantasia: d.nome_fantasia,
            cnae_codigo: String(d.cnae_fiscal),
            cnae_descricao: d.cnae_fiscal_descricao,
            logradouro: `${d.logradouro}${d.numero ? ', ' + d.numero : ''}`,
            cidade: d.municipio,
            estado: d.uf,
            telefone: d.ddd_telefone_1 || d.ddd_telefone_2,
            email: d.email,
            dados_completos: JSON.parse(JSON.stringify(d)),
            consultado_por: profile.id,
            importado: true,
          };
        });

      if (consultasToInsert.length > 0) {
        await supabase.from('cnpj_consultas').insert(consultasToInsert);
      }

      toast.success(`${imported} leads importados! ${skipped > 0 ? `${skipped} já existiam.` : ''}`);
      setCompanies(prev => prev.map(c => c.selected ? { ...c, selected: false } : c));
    } catch (err) {
      console.error('Bulk import error:', err);
      toast.error('Erro durante importação em massa');
    } finally {
      setImporting(false);
    }
  };

  // Zone heat: group by bairro
  const bairroGroups = new Map<string, number>();
  filtered.forEach(c => {
    if (c.data?.bairro) {
      const b = c.data.bairro.toUpperCase();
      bairroGroups.set(b, (bairroGroups.get(b) || 0) + 1);
    }
  });
  const hotZones = Array.from(bairroGroups.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pickaxe className="h-5 w-5" />
            Modo Mineração de Leads
          </CardTitle>
          <CardDescription>
            Faça upload de um CSV com CNPJs para enriquecer automaticamente via Receita Federal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Upload CSV
            </Button>

            {companies.length > 0 && !processing && (
              <Button onClick={processQueue}>
                <Play className="h-4 w-4 mr-2" />
                {currentIndex > 0 ? 'Continuar' : 'Iniciar'} Enriquecimento
              </Button>
            )}

            {processing && (
              <Button variant="destructive" onClick={pauseProcessing}>
                <Pause className="h-4 w-4 mr-2" />
                Pausar
              </Button>
            )}

            <span className="text-sm text-muted-foreground">
              {companies.length > 0 && `${companies.length} CNPJs • ${successCount} enriquecidos • ${errorCount} erros`}
            </span>
          </div>

          {companies.length > 0 && (
            <div className="space-y-1">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground">{progress}% concluído (intervalo de 2s entre consultas)</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Formato aceito: CSV com CNPJs de 14 dígitos (um por linha ou separados por vírgula). 
            Dica: Use o Casa dos Dados ou Econodata para gerar listas por região/CNAE.
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      {successCount > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filtros de Refinamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Select value={filterNiche} onValueChange={setFilterNiche}>
                <SelectTrigger><SelectValue placeholder="Nicho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os nichos</SelectItem>
                  {NICHE_FILTERS.map(n => (
                    <SelectItem key={n.label} value={n.label}>{n.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterUF} onValueChange={setFilterUF}>
                <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os estados</SelectItem>
                  {UF_OPTIONS.map(uf => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                placeholder="Filtrar cidade..."
                value={filterCidade}
                onChange={e => setFilterCidade(e.target.value)}
              />

              <Input
                placeholder="Filtrar bairro..."
                value={filterBairro}
                onChange={e => setFilterBairro(e.target.value)}
              />

              <Select value={filterPorte} onValueChange={setFilterPorte}>
                <SelectTrigger><SelectValue placeholder="Porte" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os portes</SelectItem>
                  {PORTE_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Profile summary */}
            {Object.keys(profileSummary).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(profileSummary).map(([id, count]) => {
                  const prof = CARGO_PROFILES.find(p => p.id === id);
                  if (!prof) return null;
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {prof.label}: {count}
                    </Badge>
                  );
                })}
                <span className="text-xs text-muted-foreground self-center ml-2">
                  {filtered.length} empresas nos filtros atuais
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hot zones */}
      {hotZones.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Zonas de Calor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {hotZones.map(([bairro, count]) => (
                <Badge
                  key={bairro}
                  variant={count >= 5 ? 'default' : 'secondary'}
                  className="cursor-pointer gap-1"
                  onClick={() => setFilterBairro(bairro)}
                >
                  <MapPin className="h-3 w-3" />
                  {bairro} ({count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      {filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Resultados ({filtered.length})
              </CardTitle>
              <div className="flex gap-2">
                {selectedCount > 0 && (
                  <Button size="sm" onClick={handleBulkImport} disabled={importing}>
                    {importing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importando...</>
                    ) : (
                      <><Download className="h-4 w-4 mr-2" />Importar {selectedCount} Selecionados</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedCount > 0 && selectedCount === filtered.filter(c => c.status === 'success').length}
                      onCheckedChange={(checked) => selectAllFiltered(!!checked)}
                    />
                  </TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Porte</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c, idx) => {
                  const d = c.data!;
                  const cnaeCode = String(d.cnae_fiscal);
                  const setor = classificarCNAE(cnaeCode);
                  const config = SETOR_CONFIG[setor];
                  const altoPotencial = isAltoPotencialLogistica(cnaeCode);
                  const isAtiva = d.situacao_cadastral === 2;

                  return (
                    <TableRow key={c.cnpj} className={altoPotencial ? 'bg-primary/5' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={c.selected}
                          onCheckedChange={() => toggleSelect(companies.indexOf(c))}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{d.razao_social}</p>
                          {d.nome_fantasia && (
                            <p className="text-xs text-muted-foreground">{d.nome_fantasia}</p>
                          )}
                          <p className="text-xs text-muted-foreground font-mono">{c.cnpj}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{d.logradouro}{d.numero ? `, ${d.numero}` : ''}</p>
                          <p className="text-muted-foreground">{d.bairro} • {d.municipio}/{d.uf}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge className={config.color}>{config.label}</Badge>
                          {altoPotencial && (
                            <Badge variant="default" className="text-xs">🚛 Alto Potencial</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{d.porte || '—'}</TableCell>
                      <TableCell>
                        {isAtiva ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle className="h-3 w-3" /> Ativa
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" /> {d.descricao_situacao_cadastral}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Processing queue (non-success items) */}
      {companies.length > 0 && companies.some(c => c.status !== 'success') && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Fila de Processamento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {companies.filter(c => c.status !== 'success').map(c => (
                <div key={c.cnpj} className="flex items-center gap-3 text-sm py-1 border-b last:border-0">
                  <span className="font-mono text-xs w-40">{c.cnpj}</span>
                  {c.status === 'pending' && <Badge variant="outline">Aguardando</Badge>}
                  {c.status === 'loading' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  {c.status === 'error' && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> {c.error}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
