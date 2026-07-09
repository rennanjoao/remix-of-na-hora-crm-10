import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1.21.0'

// Public endpoint: Resend calls this. No auth header, we verify svix signature.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const rawBody = await req.text()
    const svixId = req.headers.get('svix-id') ?? ''
    const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
    const svixSignature = req.headers.get('svix-signature') ?? ''

    // Try each stored signing secret; accept if any verifies
    const { data: domains } = await supabase
      .from('email_domains')
      .select('id, webhook_signing_secret')
      .not('webhook_signing_secret', 'is', null)

    let payload: Record<string, unknown> | null = null
    for (const d of domains ?? []) {
      try {
        const wh = new Webhook(d.webhook_signing_secret as string)
        payload = wh.verify(rawBody, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        }) as Record<string, unknown>
        break
      } catch (_e) {
        // try next
      }
    }

    if (!payload) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
    }

    const type = payload.type as string | undefined
    if (type !== 'email.received') {
      return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 })
    }

    const data = (payload.data ?? {}) as Record<string, unknown>
    const fromRaw = (data.from as string) ?? ''
    const fromEmail = fromRaw.match(/<(.+)>/)?.[1] ?? fromRaw.trim()
    const to = Array.isArray(data.to) ? (data.to[0] as string) : (data.to as string | undefined)
    const subject = (data.subject as string) ?? null
    const html = (data.html as string) ?? null
    const text = (data.text as string) ?? null
    const resendId = (data.email_id as string) ?? (data.id as string) ?? null

    // Find lead by sender email
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('email', fromEmail)
      .maybeSingle()

    await supabase.from('email_inbox').insert({
      from_email: fromEmail,
      to_email: to ?? null,
      subject,
      html,
      text,
      resend_email_id: resendId,
      lead_id: lead?.id ?? null,
      raw_payload: payload,
    })

    // Mark most recent open send to this lead as replied
    if (lead?.id) {
      const { data: lastSend } = await supabase
        .from('email_sends')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('replied', false)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (lastSend?.id) {
        await supabase
          .from('email_sends')
          .update({ replied: true, replied_at: new Date().toISOString() })
          .eq('id', lastSend.id)
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: unknown) {
    console.error('inbound-email error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})
