// Worker da fila de jobs (chamado por pg_cron a cada minuto).
// Lote limitado, lock por job (claim_jobs), retry/backoff (complete_job),
// circuit breaker por provider e modo mock via feature_flags.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_SIZE = 25;

interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface FlagRow { key: string; enabled: boolean; mock_mode: boolean }
interface HealthRow {
  provider: string;
  is_paused: boolean;
  paused_until: string | null;
  daily_limit: number | null;
  used_today: number;
  usage_reset_date: string;
}

const JOB_PROVIDER: Record<string, string> = {
  enrich_cnpj: "cnpj",
  enrich_places: "places",
  score_icp: "internal",
};

const JOB_FLAG: Record<string, string> = {
  enrich_cnpj: "ENRICHMENT_CNPJ",
  enrich_places: "ENRICHMENT_PLACES",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadHealth(db: SupabaseClient): Promise<Map<string, HealthRow>> {
  const { data } = await db.from("provider_health").select("*");
  return new Map(((data ?? []) as HealthRow[]).map((h) => [h.provider, h]));
}

async function loadFlags(db: SupabaseClient): Promise<Map<string, FlagRow>> {
  const { data } = await db.from("feature_flags").select("key, enabled, mock_mode");
  return new Map(((data ?? []) as FlagRow[]).map((f) => [f.key, f]));
}

function providerBlocked(h: HealthRow | undefined): string | null {
  if (!h) return null;
  if (h.is_paused && (!h.paused_until || new Date(h.paused_until) > new Date())) {
    return "provider_paused";
  }
  if (h.daily_limit != null && h.usage_reset_date === today() && h.used_today >= h.daily_limit) {
    return "provider_daily_limit";
  }
  return null;
}

async function markProvider(db: SupabaseClient, provider: string, ok: boolean, error?: string) {
  if (provider === "internal") return;
  const { data } = await db.from("provider_health").select("*").eq("provider", provider).maybeSingle();
  const h = data as HealthRow | null;
  if (!h) return;
  const resetNeeded = h.usage_reset_date !== today();
  if (ok) {
    await db.from("provider_health").update({
      consecutive_failures: 0,
      is_paused: false,
      paused_until: null,
      last_success_at: new Date().toISOString(),
      used_today: resetNeeded ? 1 : h.used_today + 1,
      usage_reset_date: today(),
      updated_at: new Date().toISOString(),
    }).eq("provider", provider);
  } else {
    const failures = h.consecutive_failures + 1;
    const pause = failures >= 5;
    await db.from("provider_health").update({
      consecutive_failures: failures,
      is_paused: pause,
      paused_until: pause ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
      last_failure_at: new Date().toISOString(),
      last_error: (error ?? "").slice(0, 500),
      used_today: resetNeeded ? 1 : h.used_today + 1,
      usage_reset_date: today(),
      updated_at: new Date().toISOString(),
    }).eq("provider", provider);
  }
}

// ---------- handlers ----------

async function handleEnrichCnpj(db: SupabaseClient, job: JobRow, mock: boolean) {
  const leadId = String(job.payload.lead_id ?? "");
  const cnpj = String(job.payload.cnpj ?? "").replace(/\D/g, "");
  if (!leadId || cnpj.length !== 14) throw new Error("payload inválido: lead_id/cnpj");

  if (mock) {
    await db.from("leads").update({ setor: "mock-setor" }).eq("id", leadId);
    return;
  }

  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
  const d = await res.json() as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (d.razao_social) patch.razao_social = d.razao_social;
  if (d.nome_fantasia) patch.nome_fantasia = d.nome_fantasia;
  if (d.municipio) patch.cidade = d.municipio;
  if (d.uf) patch.estado = d.uf;
  if (d.cnae_fiscal) patch.cnae_codigo = String(d.cnae_fiscal);
  if (d.cnae_fiscal_descricao) patch.cnae_descricao = String(d.cnae_fiscal_descricao);
  if (d.ddd_telefone_1) patch.telefone = String(d.ddd_telefone_1);
  if (d.email) patch.email = String(d.email).toLowerCase();

  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("leads").update(patch).eq("id", leadId);
    if (error) throw error;
  }

  await db.from("cnpj_consultas").insert({
    cnpj,
    razao_social: d.razao_social ?? null,
    nome_fantasia: d.nome_fantasia ?? null,
    cnae_codigo: d.cnae_fiscal ? String(d.cnae_fiscal) : null,
    cnae_descricao: d.cnae_fiscal_descricao ?? null,
    cidade: d.municipio ?? null,
    estado: d.uf ?? null,
    telefone: d.ddd_telefone_1 ?? null,
    email: d.email ?? null,
    dados_completos: d,
    consultado_por: job.payload.profile_id ?? null,
    lead_id: leadId,
    importado: true,
  });
}

async function handleEnrichPlaces(db: SupabaseClient, job: JobRow, mock: boolean) {
  const leadId = String(job.payload.lead_id ?? "");
  const query = String(job.payload.query ?? "");
  if (!leadId || !query) throw new Error("payload inválido: lead_id/query");
  if (mock) return;

  const key = Deno.env.get("GOOGLE_API_KEY");
  if (!key) throw new Error("GOOGLE_API_KEY ausente");

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.rating,places.websiteUri,places.internationalPhoneNumber",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "pt-BR", maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}`);
  const body = await res.json() as { places?: Array<Record<string, unknown>> };
  const place = body.places?.[0];
  if (!place) return;

  const patch: Record<string, unknown> = { place_id: place.id ?? null };
  if (place.rating != null) patch.rating = place.rating;
  if (place.websiteUri) patch.website = place.websiteUri;
  if (place.internationalPhoneNumber) patch.telefone = place.internationalPhoneNumber;
  const { error } = await db.from("leads").update(patch).eq("id", leadId);
  if (error) throw error;
}

async function handleScoreIcp(db: SupabaseClient, job: JobRow) {
  const leadId = String(job.payload.lead_id ?? "");
  if (!leadId) throw new Error("payload inválido: lead_id");
  const { error } = await db.rpc("recalc_lead_icp", { _lead_id: leadId });
  if (error) throw error;
}

// ---------- entrypoint ----------

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [health, flags] = await Promise.all([loadHealth(db), loadFlags(db)]);

  const { data: claimed, error: claimError } = await db.rpc("claim_jobs", { _limit: BATCH_SIZE });
  if (claimError) {
    console.error("claim_jobs falhou", claimError);
    return new Response(JSON.stringify({ error: claimError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const jobs = (claimed ?? []) as JobRow[];
  let done = 0, failed = 0, skipped = 0;

  for (const job of jobs) {
    const provider = JOB_PROVIDER[job.job_type] ?? "internal";
    const flagKey = JOB_FLAG[job.job_type];
    const flag = flagKey ? flags.get(flagKey) : undefined;

    if (flag && !flag.enabled) {
      await db.rpc("complete_job", { _id: job.id, _error: "feature_disabled" });
      skipped++;
      continue;
    }
    const blocked = providerBlocked(health.get(provider));
    if (blocked) {
      await db.rpc("complete_job", { _id: job.id, _error: blocked });
      skipped++;
      continue;
    }

    const mock = !!flag?.mock_mode;
    try {
      switch (job.job_type) {
        case "enrich_cnpj": await handleEnrichCnpj(db, job, mock); break;
        case "enrich_places": await handleEnrichPlaces(db, job, mock); break;
        case "score_icp": await handleScoreIcp(db, job); break;
        default: throw new Error(`job_type desconhecido: ${job.job_type}`);
      }
      if (!mock) await markProvider(db, provider, true);
      await db.rpc("complete_job", { _id: job.id, _error: null });
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`job ${job.id} (${job.job_type}) falhou:`, msg);
      if (!mock) await markProvider(db, provider, false, msg);
      await db.rpc("complete_job", { _id: job.id, _error: msg });
      failed++;
    }
  }

  return new Response(JSON.stringify({ claimed: jobs.length, done, failed, skipped }), {
    headers: { "Content-Type": "application/json" },
  });
});
