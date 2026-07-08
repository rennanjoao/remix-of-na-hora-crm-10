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
  cnpj: string;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function placePhotoUrl(name: string, width = 400) {
  return `${SUPABASE_URL}/functions/v1/places-enrich?photo_name=${encodeURIComponent(name)}&max_width=${width}`;
}

// Simple in-memory cache to avoid duplicate calls when multiple components
// consume the same lead enrichment (e.g. LeadRichProfile + PlaceFacadeDialog).
const cache = new Map<string, PlacesEnrichment>();
const inflight = new Map<string, Promise<PlacesEnrichment | null>>();

export function usePlacesEnrichment(args: Args) {
  const { cnpj, razaoSocial, nomeFantasia, municipio, uf } = args;
  const key = cnpj;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PlacesEnrichment | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!cnpj || (!razaoSocial && !nomeFantasia)) return;

    if (cache.has(key)) {
      setData(cache.get(key)!);
      return;
    }

    setLoading(true); setError(null);

    const promise = inflight.get(key) ?? (async () => {
      const { data: res, error: err } = await supabase.functions.invoke('places-enrich', {
        body: { cnpj, razao_social: razaoSocial, nome_fantasia: nomeFantasia, municipio, uf },
      });
      if (err) throw err;
      const enrichment = res as PlacesEnrichment;
      cache.set(key, enrichment);
      return enrichment;
    })();
    inflight.set(key, promise);

    promise
      .then((res) => { if (active && res) setData(res); })
      .catch((err) => { if (active) setError(err.message ?? 'erro'); })
      .finally(() => { if (active) setLoading(false); inflight.delete(key); });

    return () => { active = false; };
  }, [key, cnpj, razaoSocial, nomeFantasia, municipio, uf]);

  return { loading, data, error };
}
