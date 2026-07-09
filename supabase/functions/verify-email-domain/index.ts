import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, requireAuthenticatedUser } from '../_shared/cors.ts'

async function isAdminUser(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle()
  return !!data
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const auth = await requireAuthenticatedUser(req, corsHeaders)
  if (!auth.ok) return auth.response!

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (!(await isAdminUser(supabase, auth.userId!))) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { domain_id } = await req.json()
    if (!domain_id) throw new Error('domain_id is required')

    const { data: rec, error: recErr } = await supabase
      .from('email_domains')
      .select('*')
      .eq('id', domain_id)
      .single()
    if (recErr) throw recErr
    if (!rec.resend_domain_id) throw new Error('Domain not registered with Resend')

    // Trigger verify + fetch state
    await fetch(`https://api.resend.com/domains/${rec.resend_domain_id}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    }).catch(() => {})

    const res = await fetch(`https://api.resend.com/domains/${rec.resend_domain_id}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    })
    const data = await res.json()
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: 'Resend error', status: res.status, details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const status: string = data.status ?? 'pending'
    const verified = status === 'verified'

    const update: Record<string, unknown> = {
      status,
      dns_records: data.records ?? rec.dns_records,
    }
    if (verified && !rec.verified_at) update.verified_at = new Date().toISOString()

    // Auto-create inbound webhook when verified for the first time
    if (verified && !rec.webhook_id) {
      const endpoint = `${Deno.env.get('SUPABASE_URL')}/functions/v1/inbound-email`
      const whRes = await fetch('https://api.resend.com/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint_url: endpoint,
          events: ['email.received'],
        }),
      })
      const whData = await whRes.json()
      if (whRes.ok && whData.id) {
        update.webhook_id = whData.id
        if (whData.signing_secret) {
          // Store signing secret via Supabase Vault-style env: we can't set env vars from code,
          // so persist it in the row for the inbound function to consume. In production, prefer
          // Vault; here we log for admin visibility.
          update.dns_records = update.dns_records
          ;(update as Record<string, unknown>).webhook_signing_secret = whData.signing_secret
        }
      } else {
        console.warn('Webhook creation failed:', whData)
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from('email_domains')
      .update(update)
      .eq('id', domain_id)
      .select()
      .single()
    if (updErr) throw updErr

    return new Response(JSON.stringify({ success: true, domain: updated }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: unknown) {
    console.error('verify-email-domain error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
