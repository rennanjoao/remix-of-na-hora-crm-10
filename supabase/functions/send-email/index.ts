import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, requireAuthenticatedUser } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAuthenticatedUser(req, corsHeaders);
  if (!auth.ok) return auth.response!;

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { campaign_id, step_id, lead_id, sdr_id, to_email, subject, body_html } = await req.json();

    if (!to_email || !subject || !body_html) {
      throw new Error('Missing required fields: to_email, subject, body_html');
    }

    // Create send record with tracking ID
    const { data: sendRecord, error: insertError } = await supabase
      .from('email_sends')
      .insert({
        campaign_id,
        step_id,
        lead_id,
        sdr_id,
        status: 'enviando',
      })
      .select('id, tracking_id')
      .single();

    if (insertError) throw insertError;

    // Build tracking pixel URL
    const trackingPixelUrl = `${supabaseUrl}/functions/v1/track-email?tid=${sendRecord.tracking_id}`;

    // Inject tracking pixel into email body
    const htmlWithTracking = `${body_html}<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`;

    // Send email via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Na Hora Transporte <onboarding@resend.dev>',
        to: [to_email],
        subject,
        html: htmlWithTracking,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      await supabase
        .from('email_sends')
        .update({ status: 'erro' })
        .eq('id', sendRecord.id);
      throw new Error(`Resend API error [${resendResponse.status}]: ${JSON.stringify(resendData)}`);
    }

    // Update send record
    await supabase
      .from('email_sends')
      .update({
        status: 'enviado',
        sent_at: new Date().toISOString(),
      })
      .eq('id', sendRecord.id);

    if (lead_id && sdr_id) {
      const { error: activityError } = await supabase
        .from('lead_activities')
        .insert({
          lead_id,
          user_id: sdr_id,
          action_type: 'email_sent',
          description: `E-mail enviado para ${to_email}: ${subject}`,
          metadata: {
            send_id: sendRecord.id,
            campaign_id,
            step_id,
            to_email,
            subject,
          },
        });

      if (activityError) {
        console.warn('Lead activity email_sent insert failed:', activityError);
      }
    }

    return new Response(JSON.stringify({ success: true, send_id: sendRecord.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Send email error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
