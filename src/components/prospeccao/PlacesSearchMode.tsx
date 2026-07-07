import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Search, MapPin, Star, Phone, Globe, Download, MessageCircle, ExternalLink, Sparkles } from 'lucide-react';
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

const EXAMPLES = [
  'Distribuidora em Santos',
  'Atacado de alimentos em Ribeirão Preto',
  'Transportadora em Guarulhos',
  'Indústria química em Cubatão',
];

export function PlacesSearchMode() {
  const { profile } = useAuth();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlaceItem[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);

  const runSearch = async (q: string) => {
    const term = q.trim();
    if (term.length < 3) {
      toast.error('Digite ao menos 3 caracteres (ex: "Distribuidora em Santos")');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('places-enrich', {
        body: { text_query: term, max_results: 20 },
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

  const handleImport = async (item: PlaceItem) => {
    if (!profile) return;
    setImportingId(item.place_id);
    try {
      const phone = normalizePhone(item.phone);

      // Dedup by place_id, then phone, then name+city
      const { data: byPlace } = await supabase.from('leads').select('id').eq('place_id', item.place_id).maybeSingle();
      if (byPlace) { toast.error('Já importado (place_id)'); setImportedIds(p => new Set([...p, item.place_id])); return; }

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
        foto_url: item.photos[0] ? photoUrl(item.photos[0].name, 640) : null,
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

  const openWhats = (item: PlaceItem) => {
    const phone = normalizePhone(item.phone);
    if (!phone) return;
    const msg = encodeURIComponent(`Olá! Somos especializados em soluções de transporte e logística. Gostaríamos de apresentar nossos serviços para a ${item.display_name}.`);
    window.open(`https://wa.me/55${phone}?text=${msg}`, '_blank');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5" />
            Busca por Segmento e Localização
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
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {results.map((item) => {
            const alreadyImported = importedIds.has(item.place_id);
            const isImporting = importingId === item.place_id;
            return (
              <Card key={item.place_id} className="overflow-hidden">
                {item.photos[0] && (
                  <img
                    src={photoUrl(item.photos[0].name, 480)}
                    alt={item.display_name || ''}
                    loading="lazy"
                    className="w-full h-32 object-cover"
                  />
                )}
                <CardContent className="p-3 space-y-2">
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

                  <div className="flex flex-wrap gap-1.5 pt-1">
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
                    {item.google_maps_uri && (
                      <a href={item.google_maps_uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent/40 hover:bg-accent transition">
                        <ExternalLink className="h-3 w-3" />Maps
                      </a>
                    )}
                  </div>

                  <Separator />

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
                      <Button size="sm" variant="outline" onClick={() => openWhats(item)}>
                        <MessageCircle className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
