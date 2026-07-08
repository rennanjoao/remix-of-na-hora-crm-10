import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, Search, MapPin, Star, Phone, Globe, Download, MessageCircle,
  ExternalLink, Sparkles, Flag, Building2, LayoutGrid, List as ListIcon,
  Mail, Copy, Check, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { enrollLeadInCampaign } from '@/lib/campaign-enroll';
import { getDefaultScript, interpolateScript } from '@/lib/approach-scripts';
import { ScheduleMeetingModal } from '@/components/ScheduleMeetingModal';

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
function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function buildMapsUrl(address: string | null): string | null {
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
function logoFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return `https://logo.clearbit.com/${url.hostname}`;
  } catch { return null; }
}
function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const EXAMPLES = [
  'Distribuidora em Santos',
  'Atacado de alimentos em Ribeirão Preto',
  'Transportadora em Guarulhos',
  'Indústria química em Cubatão',
];

interface Zone { id: string; label: string; keywords: string[]; }
const ZONES: Zone[] = [
  { id: 'leste', label: 'Zona Leste', keywords: ['zona leste','itaquera','tatuape','penha','mooca','sao miguel','aricanduva','guaianases','ermelino','cangaiba','itaim paulista','sao mateus'] },
  { id: 'oeste', label: 'Zona Oeste', keywords: ['zona oeste','lapa','pinheiros','butanta','perdizes','vila leopoldina','barra funda','alto de pinheiros','raposo tavares'] },
  { id: 'sul', label: 'Zona Sul', keywords: ['zona sul','santo amaro','capao redondo','campo limpo','ipiranga','jabaquara','saude','moema','vila mariana','interlagos','m boi mirim','cidade ademar'] },
  { id: 'norte', label: 'Zona Norte', keywords: ['zona norte','santana','tucuruvi','casa verde','freguesia do o','tremembe','vila maria','vila guilherme','brasilandia','pirituba'] },
  { id: 'centro', label: 'Centro', keywords: ['centro','se','republica','bela vista','consolacao','liberdade','santa cecilia','bras','bom retiro'] },
  { id: 'interior', label: 'Interior', keywords: ['aracatuba','sao jose do rio preto','rio preto','ribeirao preto','campinas','sorocaba','bauru','presidente prudente','marilia','piracicaba'] },
];

type ContactOutcomeId =
  | 'nao_usa_servico' | 'frota_propria' | 'pediu_apresentacao'
  | 'sem_interesse_momento' | 'sem_resposta' | 'decisor_apresentado';

interface OutcomeConfig {
  id: ContactOutcomeId;
  label: string;
  short: string;
  status: string;
  is_suppressed: boolean;
  next_days: number | null;
  set_loss_reason: boolean;
  hint?: string;
}

const CONTACT_OUTCOMES: OutcomeConfig[] = [
  { id: 'nao_usa_servico', label: 'Não usa esse tipo de serviço', short: 'Não usa', status: 'perdido', is_suppressed: true, next_days: 365, set_loss_reason: true, hint: 'Suprime por 12 meses' },
  { id: 'frota_propria', label: 'Tem frota própria (objeção)', short: 'Frota própria', status: 'contato', is_suppressed: false, next_days: 45, set_loss_reason: false, hint: 'Retorna em 45 dias' },
  { id: 'pediu_apresentacao', label: 'Pediu e-mail de apresentação', short: 'Pediu apresentação', status: 'contato', is_suppressed: false, next_days: null, set_loss_reason: false, hint: 'Dispara cadência' },
  { id: 'sem_interesse_momento', label: 'Sem interesse no momento', short: 'Sem interesse', status: 'perdido', is_suppressed: true, next_days: 90, set_loss_reason: true, hint: 'Suprime por 90 dias' },
  { id: 'sem_resposta', label: 'Não atendeu / sem resposta', short: 'Sem resposta', status: 'contato', is_suppressed: false, next_days: 7, set_loss_reason: false, hint: 'Recadência em 7 dias' },
  { id: 'decisor_apresentado', label: 'Falou com decisor, apresentou serviço', short: 'Decisor OK', status: 'qualificado', is_suppressed: false, next_days: null, set_loss_reason: false, hint: 'Abre agendamento' },
];

type SortMode = 'relevance' | 'rating' | 'reviews';
type ViewMode = 'grid' | 'list';

interface ScrapedEmail { email: string; confidence: 'high' | 'medium' }
const emailCache = new Map<string, ScrapedEmail[]>();

export function PlacesSearchMode() {
  const { profile } = useAuth();
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<PlaceItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [leadIdByPlace, setLeadIdByPlace] = useState<Map<string, string>>(new Map());
  const [discardedIds, setDiscardedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [outcomeOpenId, setOutcomeOpenId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [batch, setBatch] = useState<{ current: number; total: number } | null>(null);
  const [scrapedEmails, setScrapedEmails] = useState<Map<string, ScrapedEmail[]>>(new Map());
  const [emailOverrides, setEmailOverrides] = useState<Map<string, string>>(new Map());
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{ id: string; razao_social: string; nome_fantasia: string | null; email: string | null; telefone: string | null } | null>(null);
  const [leadInfoByPlace, setLeadInfoByPlace] = useState<Map<string, { status: string; contact_outcome: string | null }>>(new Map());
  const [statusTab, setStatusTab] = useState<'todos' | 'novos' | 'trabalhados'>('todos');
  const scrapedRequested = useRef<Set<string>>(new Set());

  // Hydrate imported/outcome info from DB whenever results change
  useEffect(() => {
    const ids = results.map(r => r.place_id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from('leads') as any)
        .select('id, place_id, status, contact_outcome')
        .in('place_id', ids);
      if (cancelled || !data) return;
      const nextInfo = new Map<string, { status: string; contact_outcome: string | null }>();
      const nextImported = new Set<string>();
      const nextIds = new Map<string, string>();
      for (const l of data as any[]) {
        if (!l.place_id) continue;
        nextInfo.set(l.place_id, { status: l.status, contact_outcome: l.contact_outcome ?? null });
        nextImported.add(l.place_id);
        nextIds.set(l.place_id, l.id);
      }
      setLeadInfoByPlace(prev => { const m = new Map(prev); nextInfo.forEach((v, k) => m.set(k, v)); return m; });
      setImportedIds(prev => new Set([...prev, ...nextImported]));
      setLeadIdByPlace(prev => { const m = new Map(prev); nextIds.forEach((v, k) => m.set(k, v)); return m; });
    })();
    return () => { cancelled = true; };
  }, [results]);

  const CADENCE_OUTCOMES = new Set(['pediu_apresentacao', 'sem_resposta', 'frota_propria']);
  const getStatusBadge = (placeId: string): { label: string; className: string } => {
    const imported = importedIds.has(placeId);
    if (!imported) return { label: 'Novo', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' };
    const outcome = leadInfoByPlace.get(placeId)?.contact_outcome ?? null;
    if (outcome && CADENCE_OUTCOMES.has(outcome))
      return { label: 'Em cadência', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' };
    if (outcome) return { label: 'Contatado', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' };
    return { label: 'Importado', className: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30' };
  };

  const runSearch = async (q: string, append = false, token: string | null = null) => {
    const term = q.trim();
    if (term.length < 3) { toast.error('Digite ao menos 3 caracteres'); return; }
    append ? setLoadingMore(true) : setLoading(true);
    if (!append) { setDiscardedIds(new Set()); setResults([]); setNextPageToken(null); }
    try {
      const normalized = normalizeText(term);
      const { data, error } = await supabase.functions.invoke('places-enrich', {
        body: { text_query: normalized, max_results: 20, ...(token ? { page_token: token } : {}) },
      });
      if (error) throw new Error(error.message);
      const items = (data?.results || []) as PlaceItem[];
      setResults(prev => append ? [...prev, ...items] : items);
      setNextPageToken(data?.next_page_token || null);
      setLastQuery(term);
      if (!append && items.length === 0) toast.info('Nenhum resultado encontrado');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro na busca');
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  };

  const matchesZone = (item: PlaceItem, zoneId: string): boolean => {
    const zone = ZONES.find(z => z.id === zoneId);
    if (!zone) return true;
    const haystack = normalizeText([item.formatted_address, item.neighborhood, item.city].filter(Boolean).join(' '));
    return zone.keywords.some(k => haystack.includes(k));
  };

  const visibleResults = useMemo(() => {
    const filtered = results
      .filter(r => !discardedIds.has(r.place_id))
      .filter(r => !activeZone || matchesZone(r, activeZone));
    if (sortMode === 'rating') return [...filtered].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    if (sortMode === 'reviews') return [...filtered].sort((a, b) => (b.rating_count ?? -1) - (a.rating_count ?? -1));
    return filtered;
  }, [results, discardedIds, activeZone, sortMode]);

  // Auto-scrape emails for visible cards with website
  useEffect(() => {
    for (const item of visibleResults) {
      if (!item.website) continue;
      if (scrapedRequested.current.has(item.place_id)) continue;
      scrapedRequested.current.add(item.place_id);
      const cached = emailCache.get(item.website);
      if (cached) {
        setScrapedEmails(m => new Map(m).set(item.place_id, cached));
        continue;
      }
      supabase.functions.invoke('site-email-scrape', { body: { website: item.website } })
        .then(({ data }) => {
          const emails = (data?.emails || []) as ScrapedEmail[];
          emailCache.set(item.website!, emails);
          setScrapedEmails(m => new Map(m).set(item.place_id, emails));
        })
        .catch(() => { /* silent */ });
    }
  }, [visibleResults]);

  const insertLeadFromPlace = async (item: PlaceItem, sdrId: string): Promise<string | null> => {
    const phone = normalizePhone(item.phone);
    const photo = item.photos[0] ? photoUrl(item.photos[0].name, 640) : logoFromWebsite(item.website);
    const scrapedEmail = emailOverrides.get(item.place_id) ?? scrapedEmails.get(item.place_id)?.[0]?.email ?? null;

    const { data: byPlace } = await supabase.from('leads').select('id').eq('place_id', item.place_id).maybeSingle();
    if (byPlace) return byPlace.id;
    if (phone) {
      const { data: byPhone } = await supabase.from('leads').select('id').eq('telefone', phone).maybeSingle();
      if (byPhone) return byPhone.id;
    }
    const { data, error } = await supabase.from('leads').insert({
      razao_social: item.display_name || 'Sem nome',
      nome_fantasia: item.display_name,
      telefone: phone,
      email: scrapedEmail,
      cidade: item.city, estado: item.state, bairro: item.neighborhood,
      setor: item.category, website: item.website, rating: item.rating,
      place_id: item.place_id, foto_url: photo,
      created_by: sdrId, assigned_to: sdrId,
      status: 'novo', fonte: 'Google Places',
    }).select('id').single();
    if (error) throw error;
    return data.id;
  };

  const handleImport = async (item: PlaceItem, opts: { silent?: boolean } = {}): Promise<string | null> => {
    if (!profile) return null;
    if (!opts.silent) setImportingId(item.place_id);
    try {
      const leadId = await insertLeadFromPlace(item, profile.id);
      if (leadId) {
        setImportedIds(p => new Set([...p, item.place_id]));
        setLeadIdByPlace(p => new Map(p).set(item.place_id, leadId));
        if (!opts.silent) toast.success('Lead importado para o funil!');
      }
      return leadId;
    } catch (err) {
      console.error(err);
      if (!opts.silent) toast.error(err instanceof Error ? err.message : 'Erro ao importar');
      return null;
    } finally {
      if (!opts.silent) setImportingId(null);
    }
  };

  const handleBatchImport = async () => {
    const targets = visibleResults.filter(r => !importedIds.has(r.place_id));
    if (targets.length === 0) { toast.info('Todos os visíveis já foram importados'); return; }
    setBatch({ current: 0, total: targets.length });
    let done = 0;
    await Promise.all(targets.map(async item => {
      await handleImport(item, { silent: true });
      done++;
      setBatch({ current: done, total: targets.length });
    }));
    setBatch(null);
    toast.success(`Importados ${done} de ${targets.length}`);
  };

  const applyOutcome = async (item: PlaceItem, outcome: OutcomeConfig) => {
    if (!profile) return;
    setOutcomeOpenId(null);
    try {
      // Ensure lead exists
      let leadId = leadIdByPlace.get(item.place_id) ?? null;
      if (!leadId) leadId = await handleImport(item, { silent: true });
      if (!leadId) throw new Error('Falha ao criar lead');

      const patch: Record<string, unknown> = {
        contact_outcome: outcome.id,
        status: outcome.status,
        is_suppressed: outcome.is_suppressed,
        next_contact_date: outcome.next_days ? addDays(outcome.next_days) : null,
      };
      if (outcome.set_loss_reason) patch.loss_reason = outcome.label;

      const { error } = await supabase.from('leads').update(patch as never).eq('id', leadId);
      if (error) throw error;

      await supabase.from('lead_timeline').insert({
        lead_id: leadId,
        author_id: profile.id,
        content: `🎯 Resultado do contato: ${outcome.label}`,
        contact_type: 'outcome',
      });

      // Cadence triggers
      if (outcome.id === 'pediu_apresentacao') {
        const r = await enrollLeadInCampaign(leadId, 'apresentacao-institucional', profile.id);
        if (r.enrolled) toast.success('Cadência "Apresentação institucional" iniciada');
        else if (r.reason && r.reason !== 'Already enrolled') console.warn('enroll skipped:', r.reason);
      } else if (outcome.id === 'sem_resposta') {
        const r = await enrollLeadInCampaign(leadId, 'recaptura-pos-silencio', profile.id);
        if (r.enrolled) toast.success('Cadência "Recaptura" iniciada');
      } else if (outcome.id === 'frota_propria') {
        const r = await enrollLeadInCampaign(leadId, 'objeccao-frota-propria', profile.id);
        if (r.enrolled) toast.success('Cadência "Objeção frota própria" iniciada (retorno em ~45 dias)');
        else if (r.reason && r.reason !== 'Already enrolled') console.warn('enroll skipped:', r.reason);
      }

      if (outcome.is_suppressed) {
        setDiscardedIds(p => new Set([...p, item.place_id]));
      }

      if (outcome.id === 'decisor_apresentado') {
        setScheduleFor({
          id: leadId,
          razao_social: item.display_name || 'Sem nome',
          nome_fantasia: item.display_name,
          email: emailOverrides.get(item.place_id) ?? scrapedEmails.get(item.place_id)?.[0]?.email ?? null,
          telefone: normalizePhone(item.phone),
        });
      } else {
        toast.success(outcome.short);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar outcome');
    }
  };

  const openWhats = async (item: PlaceItem) => {
    if (!profile) return;
    const phone = normalizePhone(item.phone);
    if (!phone) return;

    const nome = item.display_name || 'sua empresa';
    const cidade = item.city || '';
    const segmento = item.category ? item.category.toLowerCase() : '';

    // Busca script default; fallback = texto antigo hardcoded (não pode quebrar se tabela vazia)
    let body: string;
    try {
      const script = await getDefaultScript('whatsapp');
      body = script
        ? interpolateScript(script.body, { nome, cidade, segmento })
        : `Olá! Sou da Na Hora Transporte. Trabalhamos com transporte rodoviário 100% dedicado e vi que a ${nome}${segmento ? ` do segmento ${segmento}` : ''}${cidade ? ` em ${cidade}` : ''} pode ter demanda logística — gostaria de trocar uma ideia rápida?`;
    } catch {
      body = `Olá! Sou da Na Hora Transporte. Trabalhamos com transporte rodoviário 100% dedicado e vi que a ${nome} pode ter demanda logística — gostaria de trocar uma ideia rápida?`;
    }

    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(body)}`, '_blank', 'noopener,noreferrer');

    // Log timeline (best-effort, no-op if lead not yet imported)
    const leadId = leadIdByPlace.get(item.place_id) || (await (async () => {
      const { data } = await supabase.from('leads').select('id').eq('place_id', item.place_id).maybeSingle();
      return data?.id ?? null;
    })());
    if (leadId) {
      await supabase.from('lead_timeline').insert({
        lead_id: leadId,
        author_id: profile.id,
        content: `📱 Tentativa de contato via WhatsApp para ${phone}`,
        contact_type: 'whatsapp',
      });
    }
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 1500);
    } catch { /* ignore */ }
  };

  const renderEmailPill = (item: PlaceItem) => {
    const emails = scrapedEmails.get(item.place_id);
    if (!emails || emails.length === 0) return null;
    const override = emailOverrides.get(item.place_id);
    const current = override ?? emails[0].email;
    const confidence = override ? 'high' : emails[0].confidence;
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <Mail className="h-3 w-3 text-primary shrink-0" />
        <Input
          value={current}
          onChange={(e) => setEmailOverrides(m => new Map(m).set(item.place_id, e.target.value))}
          className="h-6 text-xs px-1.5 py-0 flex-1 min-w-0"
        />
        <Badge variant={confidence === 'high' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0 h-4">
          {confidence === 'high' ? 'alta' : 'média'}
        </Badge>
        <button type="button" onClick={() => copyEmail(current)} className="p-1 rounded hover:bg-accent" title="Copiar">
          {copiedEmail === current ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    );
  };

  const renderOutcomePopover = (item: PlaceItem) => (
    <Popover open={outcomeOpenId === item.place_id} onOpenChange={(open) => setOutcomeOpenId(open ? item.place_id : null)}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" title="Registrar resultado" className="text-muted-foreground hover:text-foreground">
          <Flag className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="text-xs font-medium px-2 py-1.5 text-muted-foreground">Resultado do contato</p>
        <div className="flex flex-col gap-0.5">
          {CONTACT_OUTCOMES.map(o => (
            <button key={o.id} type="button" onClick={() => applyOutcome(item, o)}
              className="text-left px-2 py-1.5 rounded-md hover:bg-accent transition">
              <div className="text-xs font-medium">{o.label}</div>
              {o.hint && <div className="text-[10px] text-muted-foreground">{o.hint}</div>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  const renderCard = (item: PlaceItem) => {
    const alreadyImported = importedIds.has(item.place_id);
    const isImporting = importingId === item.place_id;
    const thumb = item.photos[0] ? photoUrl(item.photos[0].name, 240) : logoFromWebsite(item.website);
    const mapsUrl = buildMapsUrl(item.formatted_address) || item.google_maps_uri;
    return (
      <Card key={item.place_id} className="overflow-hidden">
        <CardContent className="p-3">
          <div className="flex gap-3">
            <div className="shrink-0">
              {thumb ? (
                <img src={thumb} alt={item.display_name || ''} loading="lazy"
                  className="w-24 h-24 object-cover rounded-md border border-border bg-muted"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
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
              {renderEmailPill(item)}
            </div>
          </div>
          <Separator className="my-3" />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={() => handleImport(item)} disabled={isImporting || alreadyImported}>
              {isImporting ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importando</> :
                alreadyImported ? '✓ Importado' :
                <><Download className="h-3 w-3 mr-1" />Importar</>}
            </Button>
            {item.phone && (
              <Button size="sm" variant="outline" onClick={() => openWhats(item)} title="WhatsApp">
                <MessageCircle className="h-3 w-3" />
              </Button>
            )}
            {renderOutcomePopover(item)}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderRow = (item: PlaceItem) => {
    const alreadyImported = importedIds.has(item.place_id);
    const isImporting = importingId === item.place_id;
    return (
      <TableRow key={item.place_id}>
        <TableCell className="font-medium max-w-[240px] truncate">{item.display_name}</TableCell>
        <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{item.formatted_address}</TableCell>
        <TableCell className="text-xs">{item.phone || '—'}</TableCell>
        <TableCell className="text-xs">
          {item.rating != null ? `${item.rating.toFixed(1)} (${item.rating_count ?? 0})` : '—'}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => handleImport(item)} disabled={isImporting || alreadyImported}>
              {isImporting ? <Loader2 className="h-3 w-3 animate-spin" /> : alreadyImported ? '✓' : <Download className="h-3 w-3" />}
            </Button>
            {item.phone && (
              <Button size="sm" variant="ghost" onClick={() => openWhats(item)}><MessageCircle className="h-3 w-3" /></Button>
            )}
            {renderOutcomePopover(item)}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const notImportedCount = visibleResults.filter(r => !importedIds.has(r.place_id)).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5" />
            Prospecting Hub — Busca por Segmento e Localização
          </CardTitle>
          <CardDescription>
            Digite o tipo de negócio e a cidade — ex: <span className="italic">"Distribuidora em Santos"</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); runSearch(query); }} className="flex gap-2">
            <Input placeholder="ex: Transportadora em Guarulhos" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
            <Button type="submit" disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Buscando...</> : <><Search className="h-4 w-4 mr-2" />Buscar</>}
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => { setQuery(ex); runSearch(ex); }}
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent hover:text-accent-foreground transition">
                {ex}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground mr-1">Filtrar zona:</span>
            <button type="button" onClick={() => setActiveZone(null)}
              className={`text-xs px-2 py-1 rounded-full border transition ${activeZone === null ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}>
              Todas
            </button>
            {ZONES.map(z => (
              <button key={z.id} type="button" onClick={() => setActiveZone(activeZone === z.id ? null : z.id)}
                className={`text-xs px-2 py-1 rounded-full border transition ${activeZone === z.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}>
                {z.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap px-1">
            <div className="text-xs text-muted-foreground">
              Exibindo {visibleResults.length} de {results.length} resultados
              {activeZone && ` • Zona: ${ZONES.find(z => z.id === activeZone)?.label}`}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleBatchImport} disabled={!!batch || notImportedCount === 0}>
                {batch ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Importando {batch.current} de {batch.total}...</> :
                  <><Users className="h-3.5 w-3.5 mr-1" />Importar todos os visíveis ({notImportedCount})</>}
              </Button>
              <Select value={sortMode} onValueChange={(v: SortMode) => setSortMode(v)}>
                <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">Relevância (padrão Google)</SelectItem>
                  <SelectItem value="rating">Mais bem avaliados</SelectItem>
                  <SelectItem value="reviews">Maior nº de avaliações</SelectItem>
                </SelectContent>
              </Select>
              <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as ViewMode)} size="sm">
                <ToggleGroupItem value="grid" title="Grade"><LayoutGrid className="h-3.5 w-3.5" /></ToggleGroupItem>
                <ToggleGroupItem value="list" title="Lista"><ListIcon className="h-3.5 w-3.5" /></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{visibleResults.map(renderCard)}</div>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{visibleResults.map(renderRow)}</TableBody>
              </Table>
            </Card>
          )}

          {visibleResults.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">Nenhum resultado nesta zona. Tente outro filtro.</div>
          )}

          {nextPageToken && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => runSearch(lastQuery, true, nextPageToken)} disabled={loadingMore}>
                {loadingMore ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Carregando...</> : 'Carregar mais resultados'}
              </Button>
            </div>
          )}
        </>
      )}

      <ScheduleMeetingModal
        open={!!scheduleFor}
        onOpenChange={(open) => !open && setScheduleFor(null)}
        lead={scheduleFor}
      />
    </div>
  );
}
