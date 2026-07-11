import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, requireAuthenticatedUser } from "../_shared/cors.ts";


interface Payload {
  lead_id: string;
  sdr_id: string;
  title: string;
  description?: string;
  start_time: string;
  duration_minutes: number;
  contact_name?: string;
  decisor_email?: string;
  closer_email?: string;
}

function sanitize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 30);
}

async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("Google token refresh failed:", await res.text());
    return null;
  }
  const data = await res.json();
  return data.access_token ?? null;
}

async function createGoogleMeet(
  accessToken: string,
  payload: Payload,
  companyName: string,
): Promise<{ meet_link: string; event_id: string } | null> {
  const start = new Date(payload.start_time);
  const end = new Date(start.getTime() + payload.duration_minutes * 60000);
  const attendees: { email: string }[] = [];
  if (payload.decisor_email) attendees.push({ email: payload.decisor_email });
  if (payload.closer_email) attendees.push({ email: payload.closer_email });

  const requestId = crypto.randomUUID();
  const body = {
    summary: payload.title,
    description: payload.description || `Reunião com ${companyName}`,
    start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
    attendees,
    conferenceData: {
      createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error("Google Calendar insert failed:", await res.text());
    return null;
  }
  const data = await res.json();
  const meetLink = data.hangoutLink || data.conferenceData?.entryPoints?.find((e: { entryPointType: string; uri: string }) => e.entryPointType === "video")?.uri;
  if (!meetLink) return null;
  return { meet_link: meetLink, event_id: data.id };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;
  const userId = auth.userId!;

  try {
    const payload = (await req.json()) as Payload;
    if (!payload.lead_id || !payload.sdr_id || !payload.start_time || !payload.duration_minutes || !payload.title) {
      return new Response(JSON.stringify({ error: "missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Autorização: valida que sdr_id é do próprio usuário, exceto admin/gerente.
    const { data: myProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!myProfile) {
      return new Response(JSON.stringify({ error: "profile not found" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    const role = roleRow?.role as string | undefined;
    const canActForOthers = role === "admin" || role === "gerente";

    if (!canActForOthers && payload.sdr_id !== myProfile.id) {
      return new Response(JSON.stringify({ error: "forbidden: sdr_id mismatch" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valida que o lead existe (e, se SDR, que está atribuído a ele).
    const { data: leadCheck } = await supabase
      .from("leads")
      .select("id, assigned_to, created_by, razao_social, nome_fantasia")
      .eq("id", payload.lead_id)
      .maybeSingle();
    if (!leadCheck) {
      return new Response(JSON.stringify({ error: "lead not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!canActForOthers) {
      const owns = leadCheck.assigned_to === myProfile.id || leadCheck.created_by === myProfile.id;
      if (!owns) {
        return new Response(JSON.stringify({ error: "forbidden: lead não pertence a você" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const companyName = leadCheck.nome_fantasia || leadCheck.razao_social || "empresa";

    let meetingLink: string;
    let source: "google_meet" | "jitsi_fallback" = "jitsi_fallback";

    const accessToken = await getGoogleAccessToken();
    if (accessToken) {
      const meet = await createGoogleMeet(accessToken, payload, companyName);
      if (meet) {
        meetingLink = meet.meet_link;
        source = "google_meet";
      } else {
        meetingLink = `https://meet.jit.si/NaHora-${sanitize(companyName)}-${Date.now()}`;
      }
    } else {
      meetingLink = `https://meet.jit.si/NaHora-${sanitize(companyName)}-${Date.now()}`;
    }

    const { data: meeting, error } = await supabase
      .from("meetings")
      .insert({
        lead_id: payload.lead_id,
        sdr_id: payload.sdr_id,
        created_by: myProfile.id,
        title: payload.title,
        description: payload.description || null,
        meeting_date: new Date(payload.start_time).toISOString(),
        duration_minutes: payload.duration_minutes,
        jitsi_link: meetingLink,
        meeting_link: meetingLink,
        contact_name: payload.contact_name || null,
      })
      .select("id")
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ ok: true, meeting_id: meeting.id, meeting_link: meetingLink, source }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("schedule-meeting error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
