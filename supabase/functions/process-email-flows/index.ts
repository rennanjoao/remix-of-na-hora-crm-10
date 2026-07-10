// Cron-driven processor. Scans email_sends for rows with
// status='pending' AND scheduled_for <= now, and calls send-email for each.
// Retries with exponential backoff up to 5 attempts, then marks 'erro' final.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_ATTEMPTS = 5;
const BATCH = 25;

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE env ausente');
    const supabase = createClient(supabaseUrl, serviceKey);

    const nowIso = new Date().toISOString();
    const { data: pending, error } = await supabase
      .from('email_sends')
      .select('id, flow_id, flow_step_id, recipient_id, lead_id, sdr_id, to_email, attempts')
      .eq('status', 'pending')
      .lte('scheduled_for', nowIso)
      .lt('attempts', MAX_ATTEMPTS)
      .order('scheduled_for', { ascending: true })
      .limit(BATCH);
    if (error) throw error;
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    let ok = 0, failed = 0;
    for (const row of pending) {
      // Load subject/body from the flow step
      let subject: string | null = null;
      let bodyHtml: string | null = null;
      let toEmail = row.to_email as string | null;

      if (row.flow_step_id) {
        const { data: step } = await supabase.from('email_flow_steps')
          .select('subject, body_html').eq('id', row.flow_step_id).maybeSingle();
        subject = step?.subject ?? null;
        bodyHtml = step?.body_html ?? null;
      }
      if (!toEmail && row.lead_id) {
        const { data: lead } = await supabase.from('leads').select('email').eq('id', row.lead_id).maybeSingle();
        toEmail = lead?.email ?? null;
      }
      const attempts = (row.attempts as number) + 1;

      if (!subject || !bodyHtml || !toEmail) {
        // Won't be sendable — mark as erro terminal
        await supabase.from('email_sends').update({
          status: 'erro', attempts, last_error: 'faltando subject/body/to_email',
        }).eq('id', row.id);
        if (row.recipient_id) {
          await supabase.from('email_flow_recipients').update({
            status: 'failed', error: 'faltando dados para envio',
          }).eq('id', row.recipient_id);
        }
        failed++;
        continue;
      }

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-call': serviceKey,
          },
          body: JSON.stringify({
            send_id: row.id,
            flow_id: row.flow_id,
            flow_step_id: row.flow_step_id,
            recipient_id: row.recipient_id,
            lead_id: row.lead_id,
            sdr_id: row.sdr_id,
            to_email: toEmail,
            subject,
            body_html: bodyHtml,
          }),
        });
        const j = await res.json();
        if (!res.ok || !j.success) throw new Error(j.error ?? `http ${res.status}`);
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Backoff: retry in 2^attempts minutes; terminal if maxed out
        const finalStatus = attempts >= MAX_ATTEMPTS ? 'erro' : 'pending';
        const nextRun = new Date(Date.now() + Math.pow(2, attempts) * 60_000).toISOString();
        await supabase.from('email_sends').update({
          status: finalStatus,
          attempts,
          last_error: msg.slice(0, 500),
          scheduled_for: finalStatus === 'pending' ? nextRun : null,
        }).eq('id', row.id);
        if (finalStatus === 'erro' && row.recipient_id) {
          await supabase.from('email_flow_recipients').update({
            status: 'failed', error: msg.slice(0, 500),
          }).eq('id', row.recipient_id);
        }
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: pending.length, ok, failed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('process-email-flows error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
