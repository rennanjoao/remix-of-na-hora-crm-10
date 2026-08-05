import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1.21.0'

// Endpoint público chamado pelo Resend. Sem Authorization header:
// a autenticidade é garantida pela assinatura svix.
//
// Trata bounces definitivos (hard) e reclamações de spam, suprimindo
// automaticamente o e-mail e o lead correspondente. Até aqui a supressão
// só acontecia por ação manual do SDR — isso protege a reputação do domínio.

const HARD_BOUNCE_TYPES = new Set(['Permanent', 'permanent', 'hard'])

function extractEmails(data: Record<string, unknown>): string[] {
  const out = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v !== 'string') return
    const m = v.match(/<(.+)>/)
    const e = (m?.[1] ?? v).trim().toLowerCase()
    if (e.includes('@')) out.add(e)
  }
  const to = data.to
  if (Array.isArray(to)) to.forEach(push)
  else push(to)
  // Alguns payloads trazem o destinatário afetado em bounce.recipient
  const bounce = data.bounce as Record<string, unknown> | undefined
  if (bounce) push(bounce.recipient)
  return [...out]
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const signingSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
    if (!signingSecret) {
      console.error('RESEND_WEBHOOK_SECRET não configurada')
      return new Response(JSON.stringify({ error: 'Webhook não configurado' }), { status: 500 })
    }

    const rawBody = await req.text()
    let payload: Record<string, unknown>
    try {
      const wh = new Webhook(signingSecret)
      payload = wh.verify(rawBody, {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      }) as Record<string, unknown>
    } catch (_e) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 })
    }

    const type = String(payload.type ?? '')
    const data = (payload.data ?? {}) as Record<string, unknown>

    // Só suprimimos em bounce PERMANENTE ou reclamação de spam.
    // Soft bounce (caixa cheia, servidor fora) não deve queimar o contato.
    let reason: string | null = null
    if (type === 'email.complained') {
      reason = 'spam_complaint'
    } else if (type === 'email.bounced') {
      const bounce = (data.bounce ?? {}) as Record<string, unknown>
      const bounceType = String(bounce.type ?? bounce.subType ?? '')
      if (HARD_BOUNCE_TYPES.has(bounceType) || bounceType === '') {
        // Resend nem sempre envia o tipo; nesses casos tratamos como definitivo,
        // que é o comportamento seguro para reputação de domínio.
        reason = 'hard_bounce'
      }
    }

    if (!reason) {
      return new Response(JSON.stringify({ ok: true, ignored: type }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const emails = extractEmails(data)
    if (emails.length === 0) {
      return new Response(JSON.stringify({ ok: true, ignored: 'no_recipient' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    for (const email of emails) {
      // 1. Lista de supressão (checada pelo send-email antes de cada disparo)
      const { data: existing } = await supabase
        .from('suppressed_emails')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (!existing) {
        await supabase.from('suppressed_emails').insert({ email, reason })
      }

      // 2. Suprime o lead para ele sair da fila de prospecção
      const { data: leads } = await supabase
        .from('leads')
        .select('id')
        .eq('email', email)
      for (const lead of leads ?? []) {
        await supabase.from('leads').update({
          is_suppressed: true,
          suppression_reason: reason === 'spam_complaint'
            ? 'Marcou e-mail como spam'
            : 'E-mail inválido (bounce definitivo)',
        }).eq('id', lead.id)
      }

      // 3. Marca o último envio como erro para o painel refletir a realidade
      const { data: lastSend } = await supabase
        .from('email_sends')
        .select('id')
        .eq('to_email', email)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (lastSend?.id) {
        await supabase.from('email_sends')
          .update({ status: 'erro', last_error: reason })
          .eq('id', lastSend.id)
      }
    }

    console.log(`resend-webhook: ${type} → suprimidos ${emails.join(', ')} (${reason})`)

    return new Response(JSON.stringify({ ok: true, suppressed: emails, reason }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: unknown) {
    console.error('resend-webhook error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})
