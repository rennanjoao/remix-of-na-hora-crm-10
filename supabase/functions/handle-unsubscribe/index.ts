import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public endpoint. GET renders confirmation, POST/GET with confirm=1 executes.
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const confirm = url.searchParams.get('confirm') === '1';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (!token) {
    return html('Link inválido', '<p>Token ausente.</p>', 400);
  }

  const { data: tok } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, email, used_at')
    .eq('token', token)
    .maybeSingle();

  if (!tok) return html('Link inválido', '<p>Token não encontrado.</p>', 404);

  if (req.method === 'POST' || confirm) {
    await supabase.from('suppressed_emails')
      .upsert({ email: tok.email, reason: 'unsubscribed' }, { onConflict: 'email' });
    await supabase.from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
    return html('Descadastro concluído',
      `<p>O e-mail <strong>${escape(tok.email)}</strong> foi removido da nossa lista. Não enviaremos mais mensagens.</p>`);
  }

  return html('Descadastro',
    `<p>Deseja descadastrar <strong>${escape(tok.email)}</strong>?</p>
     <p><a href="?token=${token}&confirm=1" style="display:inline-block;padding:10px 20px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;">Confirmar descadastro</a></p>`);
});

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function html(title: string, body: string, status = 200) {
  const page = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Inter,Arial,sans-serif;max-width:520px;margin:60px auto;padding:24px;color:#0f172a}h1{font-size:22px;margin:0 0 12px}</style>
</head><body><h1>${escape(title)}</h1>${body}</body></html>`;
  return new Response(page, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
