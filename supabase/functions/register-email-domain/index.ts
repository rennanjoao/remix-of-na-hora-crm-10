import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders, requireAuthenticatedUser } from '../_shared/cors.ts'

async function requireAdmin(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle()
  if (error) throw error
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

    const isAdmin = await requireAdmin(supabase, auth.userId!)
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { domain } = await req.json()
    if (!domain || typeof domain !== 'string') {
      throw new Error('domain is required')
    }

    // Call Resend API
    const resendRes = await fetch('https://api.resend.com/domains', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    })

    const resendData = await resendRes.json()
    if (!resendRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Resend error', status: resendRes.status, details: resendData }),
        { status: resendRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { data: row, error: dbError } = await supabase
      .from('email_domains')
      .upsert(
        {
          domain,
          resend_domain_id: resendData.id,
          status: resendData.status ?? 'pending',
          dns_records: resendData.records ?? [],
          created_by: auth.userId,
        },
        { onConflict: 'domain' },
      )
      .select()
      .single()

    if (dbError) throw dbError

    return new Response(JSON.stringify({ success: true, domain: row }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: unknown) {
    console.error('register-email-domain error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
