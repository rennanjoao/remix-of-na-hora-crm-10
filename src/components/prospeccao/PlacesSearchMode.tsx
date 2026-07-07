import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Loader2, Search, MapPin, Star, Phone, Globe, Download, MessageCircle,
  ExternalLink, Sparkles, XCircle, Building2,
} from 'lucide-react';
import { toast } from 'sonner';

interface PlaceItem {
  place_id: string;
  display_name: string | null;
  formatted_address: string | null;
  phone: string | null;
  rating: number | null;
  rating_count: number | null;
  website: string | null;
  google_maps_uri: string | null;
  category: string | null;
  business_status: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  photos: { name: string; width: number; height: number }[];
}

const SUPABASE_URL = 'https://cyekmwsgpcxjakpbeyea.supabase.co';

function photoUrl(name: string, w = 320) {
  return `${SUPABASE_URL}/functions/v1/places-enrich?photo_name=${encodeURIComponent(name)}&max_width=${w}`;
}

function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  return p.replace(/\D/g, '').slice(-11);
}

/** Remove acentos, caracteres especiais e coloca em lowercase. */
function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Deep link seguro do Google Maps por endereço (não bloqueado por CORS). */
function buildMapsUrl(address: string | null): string | null {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Fallback de logo por site (Clearbit) para dar contexto visual. */
function logoFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return `https://logo.clearbit.com/${url.hostname}`;
  } catch {
    return null;
  }
}

const EXAMPLES = [
  'Distribuidora em Santos',
  'Atacado de alimentos em Ribeirão Preto',
  'Transportadora em Guarulhos',
  'Indústria química em Cubatão',
];

interface Zone {
  id: string;
  label: string;
  keywords: string[]; // já normalizados
}

const ZONES: Zone[] = [
  { id: 'leste',    label: 'Zona Leste',   keywords: ['zona leste', 'itaquera', 'tatuape', 'penha', 'mooca', 'sao miguel', 'aricanduva', 'guaianases', 'ermelino', 'cangaiba', 'itaim paulista', 'sao mateus'] },
  { id: 'oeste',    label: 'Zona Oeste',   keywords: ['zona oeste', 'lapa', 'pinheiros', 'butanta', 'perdizes', 'vila leopoldina', 'barra funda', 'alto de pinheiros', 'raposo tavares'] },
  { id: 'sul',      label: 'Zona Sul',     keywords: ['zona sul', 'santo amaro', 'capao redondo', 'campo limpo', 'ipiranga', 'jabaquara', 'saude', 'moema', 'vila mariana', 'interlagos', 'm boi mirim', 'cidade ademar'] },
  { id: 'norte',    label: 'Zona Norte',   keywords: ['zona norte', 'santana', 'tucuruvi', 'casa verde', 'freguesia do o', 'tremembe', 'vila maria', 'vila guilherme', 'brasilandia', 'pirituba'] },
  { id: 'centro',   label: 'Centro',       keywords: ['centro', 'se', 'republica', 'bela vista', 'consolacao', 'liberdade', 'santa cecilia', 'bras', 'bom retiro'] },
  { id: 'interior', label: 'Interior',     keywords: ['aracatuba', 'sao jose do rio preto', 'rio preto', 'ribeirao preto', 'campinas', 'sorocaba', 'bauru', 'presidente prudente', 'marilia', 'piracicaba'] },
];

const LOSS_REASONS = [
  'Não utiliza transporte dedicado',
  'Não atendeu / Sem contato',
  'Fora da área de cobertura',
  'Lead duplicado',
];

export function PlacesSearchMode() {
  const { profile } = useAuth();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlaceItem[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [discardedIds, setDiscardedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [discardOpenId, setDiscardOpenId] = useState<string | null>(null);

  const runSearch = async (q: string) => {
    const term = q.trim();
    if (term.length < 3) {
      toast.error('Digite ao menos 3 caracteres (ex: "Distribuidora em Santos")');
      return;
    }
    setLoading(true);
    setDiscardedIds(new Set());
    try {
      const normalized = normalizeText(term); // fuzzy: tolera acentos e caixa
      const { data, error } = await supabase.functions.invoke('places-enrich', {
        body: { text_query: normalized, max_results: 20 },
      });
      if (error) throw new Error(error.message);
      const items = (data?.results || []) as PlaceItem[];
      setResults(items);
      if (items.length === 0) toast.info('Nenhum resultado encontrado — tente refinar o termo');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro na busca');
    } finally {
      setLoading(false);
    }
  };

  const matchesZone = (item: PlaceItem, zoneId: string): boolean => {
    const zone = ZONES.find(z => z.id === zoneId);
    if (!zone) return true;
    const haystack = normalizeText(
      [item.formatted_address, item.neighborhood, item.city].filter(Boolean).join(' ')
    );
    return zone.keywords.some(k => haystack.includes(k));
  };

  const visibleResults = useMemo(() => {
    return results
      .filter(r => !discardedIds.has(r.place_id))
      .filter(r => !activeZone || matchesZone(r, activeZone));
  }, [results, discardedIds, activeZone]);

  const handleImport = async (item: PlaceItem) => {
    if (!profile) return;
    setImportingId(item.place_id);
    try {
      const phone = normalizePhone(item.phone);
      const photo = item.photos[0] ? photoUrl(item.photos[0].name, 640) : logoFromWebsite(item.website);

      const { data: byPlace } = await supabase.from('leads').select('id').eq('place_id', item.place_id).maybeSingle();
      if (byPlace) { toast.error('Já importado'); setImportedIds(p => new Set([...p, item.place_id])); return; }

      if (phone) {
        const { data: byPhone } = await supabase.from('leads').select('id').eq('telefone', phone).maybeSingle();
        if (byPhone) { toast.error('Lead com este telefone já existe'); setImportedIds(p => new Set([...p, item.place_id])); return; }
      }

      const { error } = await supabase.from('leads').insert({
        razao_social: item.display_name || 'Sem nome',
        nome_fantasia: item.display_name,
        telefone: phone,
        cidade: item.city,
        estado: item.state,
        bairro: item.neighborhood,
        setor: item.category,
        website: item.website,
        rating: item.rating,
        place_id: item.place_id,
        foto_url: photo,
        created_by: profile.id,
        assigned_to: profile.id,
        status: 'novo',
        fonte: 'Google Places',
      });
      if (error) throw error;
      setImportedIds(p => new Set([...p, item.place_id]));
      toast.success('Lead importado para o funil!');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro ao importar');
    } finally {
      setImportingId(null);
    }
  };

  const handleDiscard = async (item: PlaceItem, reason: string) => {
    setDiscardOpenId(null);
    try {
      // Se o lead já foi importado, marca como perdido com motivo.
      const { data: existing } = await supabase
        .from('leads').select('id').eq('place_id', item.place_id).maybeSingle();
      if (existing) {
        await supabase.from('leads')
          .update({ status: 'perdido', loss_reason: reason } as never)
          .eq('id', existing.id);
      }
      setDiscardedIds(p => new Set([...p, item.place_id]));
      toast.success(`Descartado: ${reason}`);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao descartar');
    }
  };

  const openWhats = (item: PlaceItem) => {
    const phone = normalizePhone(item.phone);
    if (!phone) return;
    const msg = encodeURIComponent(`Olá! Somos especializados em soluções de transporte dedicado. Gostaríamos de apresentar nossos serviços para a ${item.display_name}.`);
    window.open(`https://wa.me/55${phone}?text=${msg}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5" />
            Prospecting Hub — Busca por Segmento e Localização
          </CardTitle>
          <CardDescription>
            Digite o tipo de negócio e a cidade — ex: <span className="italic">"Distribuidora em Santos"</span>, <span className="italic">"Atacado de alimentos em Ribeirão Preto"</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
            className="flex gap-2"
          >
            <Input
              placeholder="ex: Transportadora em Guarulhos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Buscando...</> : <><Search className="h-4 w-4 mr-2" />Buscar</>}
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setQuery(ex); runSearch(ex); }}
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent hover:text-accent-foreground transition"
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Zone chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground mr-1">Filtrar zona:</span>
            <button
              type="button"
              onClick={() => setActiveZone(null)}
              className={`text-xs px-2 py-1 rounded-full border transition ${
                activeZone === null
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:bg-accent'
              }`}
            >
              Todas
            </button>
            {ZONES.map(z => (
              <button
                key={z.id}
                type="button"
                onClick={() => setActiveZone(activeZone === z.id ? null : z.id)}
                className={`text-xs px-2 py-1 rounded-full border transition ${
                  activeZone === z.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground px-1">
            Exibindo {visibleResults.length} de {results.length} resultados
            {activeZone && ` • Zona: ${ZONES.find(z => z.id === activeZone)?.label}`}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleResults.map((item) => {
              const alreadyImported = importedIds.has(item.place_id);
              const isImporting = importingId === item.place_id;
              const thumb = item.photos[0] ? photoUrl(item.photos[0].name, 240) : logoFromWebsite(item.website);
              const mapsUrl = buildMapsUrl(item.formatted_address) || item.google_maps_uri;

              return (
                <Card key={item.place_id} className="overflow-hidden">
                  <CardContent className="p-3">
                    {/* Layout horizontal: thumbnail (fachada/logo) + informações */}
                    <div className="flex gap-3">
                      <div className="shrink-0">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={item.display_name || ''}
                            loading="lazy"
                            className="w-24 h-24 object-cover rounded-md border border-border bg-muted"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-md border border-border bg-muted flex items-center justify-center">
                            <Building2 className="h-8 w-8 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-sm leading-tight truncate">{item.display_name}</h3>
                            {item.category && <p className="text-xs text-muted-foreground truncate">{item.category}</p>}
                          </div>
                          {item.rating != null && (
                            <Badge variant="outline" className="gap-1 shrink-0 text-xs">
                              <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                              {item.rating.toFixed(1)}
                              {item.rating_count ? <span className="text-muted-foreground">({item.rating_count})</span> : null}
                            </Badge>
                          )}
                        </div>

                        {item.formatted_address && (
                          <p className="text-xs text-muted-foreground flex items-start gap-1">
                            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{item.formatted_address}</span>
                          </p>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          {item.phone && (
                            <a href={`tel:${item.phone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent/40 hover:bg-accent transition">
                              <Phone className="h-3 w-3" />{item.phone}
                            </a>
                          )}
                          {item.website && (
                            <a href={item.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent/40 hover:bg-accent transition">
                              <Globe className="h-3 w-3" />Site
                            </a>
                          )}
                          {mapsUrl && (
                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent/40 hover:bg-accent transition">
                              <ExternalLink className="h-3 w-3" />Maps
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <Separator className="my-3" />

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleImport(item)}
                        disabled={isImporting || alreadyImported}
                      >
                        {isImporting ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importando</> :
                          alreadyImported ? '✓ Importado' :
                          <><Download className="h-3 w-3 mr-1" />Importar</>}
                      </Button>
                      {item.phone && (
                        <Button size="sm" variant="outline" onClick={() => openWhats(item)} title="WhatsApp">
                          <MessageCircle className="h-3 w-3" />
                        </Button>
                      )}

                      <Popover
                        open={discardOpenId === item.place_id}
                        onOpenChange={(open) => setDiscardOpenId(open ? item.place_id : null)}
                      >
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="ghost" title="Descartar lead" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64 p-2">
                          <p className="text-xs font-medium px-2 py-1.5 text-muted-foreground">
                            Motivo do descarte
                          </p>
                          <div className="flex flex-col gap-0.5">
                            {LOSS_REASONS.map(reason => (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => handleDiscard(item, reason)}
                                className="text-left text-xs px-2 py-2 rounded-md hover:bg-accent transition"
                              >
                                {reason}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {visibleResults.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhum resultado nesta zona. Tente outro filtro.
            </div>
          )}
        </>
      )}
    </div>
  );
}
