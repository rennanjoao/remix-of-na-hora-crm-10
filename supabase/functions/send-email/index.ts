import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, requireAuthenticatedUser } from '../_shared/cors.ts'
import { renderVariables, leadToVars } from '../_shared/email-render.ts'

// Internal processor calls this function using the service-role key with
// `x-internal-call: true`. Human calls go through Authorization Bearer <jwt>.
async function authorize(req: Request, cors: Record<string, string>) {
  const internal = req.headers.get('x-internal-call');
  if (internal === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return { ok: true as const, internal: true as const };
  }
  const auth = await requireAuthenticatedUser(req, cors);
  return auth.ok ? { ok: true as const, internal: false as const } : { ok: false as const, response: auth.response! };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const check = await authorize(req, corsHeaders);
  if (!check.ok) return check.response;

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY não configurada');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE env ausente');
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      flow_id,
      flow_step_id,
      recipient_id,
      send_id,      // existing pending row (from processor)
      lead_id,
      sdr_id,
      to_email,
      subject: subjectIn,
      body_html: bodyIn,
      test = false,
    } = body as Record<string, unknown>;

    if (!subjectIn || !bodyIn) throw new Error('subject e body_html obrigatórios');
    if (!to_email) throw new Error('to_email obrigatório');

    // --- 1. Resolve verified sender domain
    const { data: domain } = await supabase
      .from('email_domains')
      .select('domain, status')
      .eq('status', 'verified')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!domain) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nenhum domínio de e-mail verificado. Configure em Admin → Domínio de E-mail.',
      }), { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const fromAddress = `Na Hora Transporte <no-reply@${domain.domain}>`;

    // --- 2. Suppression list
    if (!test) {
      const { data: sup } = await supabase
        .from('suppressed_emails')
        .select('id')
        .eq('email', String(to_email).toLowerCase())
        .maybeSingle();
      if (sup) {
        // Mark any pending send as suppressed and exit
        if (send_id) {
          await supabase.from('email_sends').update({ status: 'suppressed', last_error: 'suppressed' }).eq('id', send_id);
        }
        return new Response(JSON.stringify({ success: false, error: 'E-mail em lista de supressão' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- 3. Lead vars
    let leadVars: Record<string, string> = {};
    if (lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('nome_fantasia, razao_social, cidade, setor, email, telefone')
        .eq('id', lead_id)
        .maybeSingle();
      leadVars = leadToVars(lead as Record<string, unknown> | null);
    }
    const varCtx = { lead: leadVars, sdr: { nome: 'Equipe Na Hora' } };

    const subject = renderVariables(String(subjectIn), varCtx);
    const rendered = renderVariables(String(bodyIn), varCtx);

    // --- 4. Ensure email_sends row (create or reuse)
    let sendRow: { id: string; tracking_id: string; unsubscribe_token: string | null };
    if (send_id) {
      const { data, error } = await supabase.from('email_sends')
        .update({ status: 'enviando', attempts: 0 })
        .eq('id', String(send_id))
        .select('id, tracking_id, unsubscribe_token')
        .single();
      if (error) throw error;
      sendRow = data;
    } else {
      const { data, error } = await supabase.from('email_sends').insert({
        flow_id: flow_id ?? null,
        flow_step_id: flow_step_id ?? null,
        recipient_id: recipient_id ?? null,
        lead_id,
        sdr_id,
        to_email,
        subject,
        body_html: rendered,
        status: 'enviando',
      }).select('id, tracking_id, unsubscribe_token').single();
      if (error) throw error;
      sendRow = data;
    }

    // --- 5. Unsubscribe token
    let unsubToken = sendRow.unsubscribe_token;
    if (!unsubToken && !test) {
      const { data: tok } = await supabase.from('email_unsubscribe_tokens').insert({
        email: String(to_email).toLowerCase(),
        lead_id: lead_id ?? null,
      }).select('token').single();
      unsubToken = tok?.token ?? null;
      if (unsubToken) {
        await supabase.from('email_sends').update({ unsubscribe_token: unsubToken }).eq('id', sendRow.id);
      }
    }

    // --- 6. Tracking pixel + unsubscribe footer
    const trackingPixelUrl = `${supabaseUrl}/functions/v1/track-email?tid=${sendRow.tracking_id}`;
    const unsubUrl = unsubToken
      ? `${supabaseUrl}/functions/v1/handle-unsubscribe?token=${unsubToken}`
      : null;
    const footer = unsubUrl
      ? `<div style="max-width:600px;margin:0 auto;padding:0 24px 24px 24px;font-family:Inter,Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">Não quer mais receber? <a href="${unsubUrl}" style="color:#64748b;">Descadastrar</a>.</div>`
      : '';
    const finalHtml = `${rendered}${footer}<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`;

    // --- 7. Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to_email],
        subject,
        html: finalHtml,
        headers: unsubUrl ? { 'List-Unsubscribe': `<${unsubUrl}>` } : undefined,
      }),
    });
    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      await supabase.from('email_sends').update({
        status: 'erro',
        last_error: JSON.stringify(resendData).slice(0, 1000),
      }).eq('id', sendRow.id);
      if (recipient_id) {
        await supabase.from('email_flow_recipients').update({
          status: 'failed', error: JSON.stringify(resendData).slice(0, 500),
        }).eq('id', String(recipient_id));
      }
      throw new Error(`Resend API [${resendResponse.status}]: ${JSON.stringify(resendData)}`);
    }

    await supabase.from('email_sends').update({
      status: 'enviado',
      sent_at: new Date().toISOString(),
      subject,
      body_html: rendered,
    }).eq('id', sendRow.id);

    if (recipient_id) {
      await supabase.from('email_flow_recipients').update({
        status: 'sent', sent_at: new Date().toISOString(), error: null,
      }).eq('id', String(recipient_id));
    }

    if (lead_id && sdr_id && !test) {
      await supabase.from('lead_activities').insert({
        lead_id,
        user_id: sdr_id,
        action_type: 'email_sent',
        description: `E-mail enviado para ${to_email}: ${subject}`,
        metadata: { send_id: sendRow.id, flow_id, flow_step_id, to_email, subject },
      });
    }

    return new Response(JSON.stringify({ success: true, send_id: sendRow.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('send-email error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
