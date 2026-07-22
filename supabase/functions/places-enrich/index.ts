import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, requireAuthenticatedUser } from "../_shared/cors.ts";

const CACHE_TTL_HOURS = 24 * 7;

interface PlacePhoto { name: string; widthPx: number; heightPx: number }
interface AddressComponent { types?: string[]; shortText?: string; longText?: string }
interface PlaceSearchItem {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: AddressComponent[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  photos?: PlacePhoto[];
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  priceLevel?: string;
}
interface PlaceDetails {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: PlacePhoto[];
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;



  try {
    const apiKey = Deno.env.get("GOOGLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "GOOGLE_API_KEY não configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { cnpj, razao_social, nome_fantasia, municipio, uf, photo_name, max_width, text_query, max_results, page_token } = await req.json();

    // Photo proxy mode
    if (photo_name) {
      const url = `https://places.googleapis.com/v1/${photo_name}/media?maxWidthPx=${max_width || 800}&key=${apiKey}`;
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "photo fetch failed", status: res.status }), {
          status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(res.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=604800",
        },
      });
    }

    // Multi-result Text Search mode (search by term + location, e.g. "Distribuidora em Santos")
    if (text_query && String(text_query).trim().length > 0) {
      const listRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.shortFormattedAddress",
            "places.addressComponents",
            "places.nationalPhoneNumber",
            "places.internationalPhoneNumber",
            "places.rating",
            "places.userRatingCount",
            "places.websiteUri",
            "places.googleMapsUri",
            "places.primaryTypeDisplayName",
            "places.types",
            "places.photos",
            "places.businessStatus",
            "places.currentOpeningHours.openNow",
            "places.currentOpeningHours.weekdayDescriptions",
            "places.priceLevel",
            "nextPageToken",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: String(text_query),
          languageCode: "pt-BR",
          regionCode: "BR",
          maxResultCount: Math.min(Math.max(Number(max_results) || 20, 1), 20),
          ...(page_token ? { pageToken: String(page_token) } : {}),
        }),
      });

      if (!listRes.ok) {
        const body = await listRes.text();
        return new Response(JSON.stringify({ error: "searchText failed", status: listRes.status, body }), {
          status: listRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const listData = await listRes.json();
      const items = ((listData.places ?? []) as PlaceSearchItem[]).map((p) => {
        const comps: AddressComponent[] = p.addressComponents ?? [];
        const findComp = (type: string) =>
          comps.find((c) => (c.types ?? []).includes(type))?.shortText ??
          comps.find((c) => (c.types ?? []).includes(type))?.longText ?? null;
        return {
          place_id: p.id,
          display_name: p.displayName?.text ?? null,
          formatted_address: p.formattedAddress ?? p.shortFormattedAddress ?? null,
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
          rating: p.rating ?? null,
          rating_count: p.userRatingCount ?? null,
          website: p.websiteUri ?? null,
          google_maps_uri: p.googleMapsUri ?? null,
          category: p.primaryTypeDisplayName?.text ?? null,
          business_status: p.businessStatus ?? null,
          city: findComp("administrative_area_level_2"),
          state: findComp("administrative_area_level_1"),
          neighborhood: findComp("sublocality_level_1") ?? findComp("sublocality"),
          postal_code: findComp("postal_code"),
          types: (p.types ?? []).slice(0, 6),
          open_now: p.currentOpeningHours?.openNow ?? null,
          opening_hours: p.currentOpeningHours?.weekdayDescriptions ?? null,
          price_level: p.priceLevel ?? null,
          photos: (p.photos ?? []).slice(0, 3).map((ph) => ({
            name: ph.name, width: ph.widthPx, height: ph.heightPx,
          })),
        };
      });

      return new Response(JSON.stringify({ results: items, next_page_token: listData.nextPageToken || null, _source: "live" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanCnpj = String(cnpj ?? "").replace(/\D/g, "");
    const query = [nome_fantasia || razao_social, municipio, uf].filter(Boolean).join(" ");
    if (!query) {
      return new Response(JSON.stringify({ error: "query vazia" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Cache check
    if (cleanCnpj.length === 14) {
      const { data: cached } = await supabase
        .from("cnpj_consultas")
        .select("id, dados_completos, created_at")
        .eq("cnpj", cleanCnpj)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const enrich = (cached?.dados_completos as Record<string, { _cached_at?: string } & Record<string, unknown>> | null)?.places_enrichment;
      if (enrich && enrich._cached_at) {
        const age = Date.now() - new Date(enrich._cached_at).getTime();
        if (age < CACHE_TTL_HOURS * 3600 * 1000) {
          return new Response(JSON.stringify({ ...enrich, _source: "cache" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Text Search
    const searchRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "pt-BR", regionCode: "BR", maxResultCount: 1 }),
    });

    if (!searchRes.ok) {
      const body = await searchRes.text();
      return new Response(JSON.stringify({ error: "searchText failed", status: searchRes.status, body }), {
        status: searchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchData = await searchRes.json();
    const place = searchData.places?.[0];
    if (!place?.id) {
      const empty = { found: false, _cached_at: new Date().toISOString() };
      return new Response(JSON.stringify({ ...empty, _source: "live" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Place Details
    const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${place.id}?languageCode=pt-BR`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,internationalPhoneNumber,nationalPhoneNumber,rating,userRatingCount,googleMapsUri,websiteUri,photos",
      },
    });

    if (!detailsRes.ok) {
      const body = await detailsRes.text();
      return new Response(JSON.stringify({ error: "placeDetails failed", status: detailsRes.status, body }), {
        status: detailsRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const details: PlaceDetails = await detailsRes.json();

    const result = {
      found: true,
      place_id: details.id,
      display_name: details.displayName?.text,
      formatted_address: details.formattedAddress,
      phone: details.internationalPhoneNumber || details.nationalPhoneNumber || null,
      rating: details.rating || null,
      rating_count: details.userRatingCount || null,
      google_maps_uri: details.googleMapsUri,
      website: details.websiteUri || null,
      photos: (details.photos || []).slice(0, 6).map(p => ({
        name: p.name, width: p.widthPx, height: p.heightPx,
      })),
      _cached_at: new Date().toISOString(),
    };

    // Persist to cache
    if (cleanCnpj.length === 14) {
      const { data: existing } = await supabase
        .from("cnpj_consultas")
        .select("id, dados_completos")
        .eq("cnpj", cleanCnpj)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const merged = { ...((existing.dados_completos as Record<string, unknown>) ?? {}), places_enrichment: result };
        await supabase.from("cnpj_consultas").update({ dados_completos: merged }).eq("id", existing.id);
      }
    }

    return new Response(JSON.stringify({ ...result, _source: "live" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("places-enrich error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
