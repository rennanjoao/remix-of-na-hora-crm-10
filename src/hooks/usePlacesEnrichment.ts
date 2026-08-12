import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlacePhoto { name: string; width: number; height: number }
export interface PlacesEnrichment {
  found: boolean;
  place_id?: string;
  display_name?: string;
  formatted_address?: string;
  phone?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  google_maps_uri?: string;
  website?: string | null;
  photos?: PlacePhoto[];
  _source?: string;
}

interface Args {
  cnpj?: string | null;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

export type EnrichmentStatus = 'idle' | 'loading' | 'found' | 'not_found' | 'error';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function placePhotoUrl(name: string, width = 400) {
  return `${SUPABASE_URL}/functions/v1/places-enrich?photo_name=${encodeURIComponent(name)}&max_width=${width}`;
}

/**
 * Retorna a chave de cache/consulta ou null quando não há dados suficientes.
 * Preferência: CNPJ. Fallback: nome da empresa (+ cidade, quando existir).
 */
export function buildEnrichmentKey(args: Args): string | null {
  const cnpj = (args.cnpj || '').replace(/\D/g, '');
  if (cnpj.length === 14) return `cnpj:${cnpj}`;
  const name = (args.nomeFantasia || args.razaoSocial || '').trim();
  if (!name) return null;
  const city = (args.municipio || '').trim();
  return `name:${name.toLowerCase()}|${city.toLowerCase()}`;
}

// Simple in-memory cache to avoid duplicate calls when multiple components
// consume the same lead enrichment (e.g. LeadRichProfile + PlaceFacadeDialog).
const cache = new Map<string, PlacesEnrichment>();
const inflight = new Map<string, Promise<PlacesEnrichment | null>>();

export function usePlacesEnrichment(args: Args) {
  const { cnpj, razaoSocial, nomeFantasia, municipio, uf } = args;
  const key = buildEnrichmentKey(args);
  const [data, setData] = useState<PlacesEnrichment | null>(() => (key ? cache.get(key) ?? null : null));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EnrichmentStatus>(() => {
    if (!key) return 'idle';
    const cached = cache.get(key);
    if (!cached) return 'idle';
    return cached.found ? 'found' : 'not_found';
  });

  useEffect(() => {
    let active = true;
    if (!key) { setStatus('idle'); setData(null); return; }

    const cached = cache.get(key);
    if (cached) {
      setData(cached);
      setStatus(cached.found ? 'found' : 'not_found');
      return;
    }

    setStatus('loading'); setError(null);

    const promise = inflight.get(key) ?? (async () => {
      const { data: res, error: err } = await supabase.functions.invoke('places-enrich', {
        body: { cnpj: cnpj || '', razao_social: razaoSocial, nome_fantasia: nomeFantasia, municipio, uf },
      });
      if (err) throw err;
      const enrichment = res as PlacesEnrichment;
      cache.set(key, enrichment);
      return enrichment;
    })();
    inflight.set(key, promise);

    promise
      .then((res) => {
        if (!active) return;
        if (res) { setData(res); setStatus(res.found ? 'found' : 'not_found'); }
        else setStatus('not_found');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'erro ao consultar Google Places');
        setStatus('error');
      })
      .finally(() => { inflight.delete(key); });

    return () => { active = false; };
  }, [key, cnpj, razaoSocial, nomeFantasia, municipio, uf]);

  return { loading: status === 'loading', data, error, status };
}
