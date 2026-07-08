import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";

type AppRole = "admin" | "sdr" | "gerente" | "motorista";

interface Payload {
  email: string;
  senha_temporaria: string;
  full_name: string;
  role: AppRole;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) Verificar que o caller é admin usando o JWT dele
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const asCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin, error: roleErr } = await asCaller.rpc("has_role", {
      _user_id: userData.user.id, _role: "admin",
    });
    if (roleErr || !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Criar usuário com service role
    const body = (await req.json()) as Payload;
    const { email, senha_temporaria, full_name, role } = body;
    const validRoles: AppRole[] = ["admin", "sdr", "gerente", "motorista"];
    if (!email || !senha_temporaria || !full_name || !validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: senha_temporaria,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? "Failed to create user" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Substitui o role padrão criado pelo trigger handle_new_user
    await admin.from("user_roles").delete().eq("user_id", created.user.id);
    const { error: insertErr } = await admin
      .from("user_roles")
      .insert({ user_id: created.user.id, role });
    if (insertErr) {
      return new Response(JSON.stringify({ error: `Usuário criado, mas falhou ao definir role: ${insertErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Garante full_name no profile
    await admin.from("profiles").update({ full_name }).eq("user_id", created.user.id);

    return new Response(JSON.stringify({ ok: true, user_id: created.user.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
