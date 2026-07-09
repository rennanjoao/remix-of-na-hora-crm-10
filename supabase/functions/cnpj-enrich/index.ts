import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, requireAuthenticatedUser } from "../_shared/cors.ts";

const CACHE_TTL_HOURS = 720;

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;

  try {
    const { cnpj } = await req.json();
    const clean = String(cnpj ?? "").replace(/\D/g, "");
    if (clean.length !== 14) {
      return new Response(JSON.stringify({ error: "CNPJ inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cached } = await supabase
      .from("cnpj_consultas")
      .select("dados_completos, created_at")
      .eq("cnpj", clean)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isFresh =
      cached &&
      cached.dados_completos &&
      Date.now() - new Date(cached.created_at).getTime() <
        CACHE_TTL_HOURS * 3600 * 1000;

    if (isFresh) {
      return new Response(
        JSON.stringify({ ...(cached.dados_completos as object), _source: "cache" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let data: Record<string, unknown> | null = null;
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
      if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
      data = await res.json();
      (data as Record<string, unknown>)._source = "live";
    } catch (_e) {
      const res2 = await fetch(`https://www.receitaws.com.br/v1/cnpj/${clean}`);
      if (!res2.ok) {
        return new Response(JSON.stringify({ error: "CNPJ não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      data = await res2.json();
      (data as Record<string, unknown>)._source = "receitaws_fallback";
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro interno" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
