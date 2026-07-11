import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'


// 1x1 transparent GIF pixel
const TRACKING_PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const trackingId = url.searchParams.get('tid');

    if (!trackingId) {
      return new Response(TRACKING_PIXEL, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing environment variables');
      return new Response(TRACKING_PIXEL, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store', ...corsHeaders },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: send, error: fetchError } = await supabase
      .from('email_sends')
      .select('id, open_count, lead_id, flow_id')
      .eq('tracking_id', trackingId)
      .maybeSingle();

    if (send && !fetchError) {
      const nextOpenCount = (send.open_count ?? 0) + 1;

      await supabase
        .from('email_sends')
        .update({
          open_count: nextOpenCount,
          last_opened_at: new Date().toISOString(),
          status: 'aberto',
        })
        .eq('id', send.id);

      // Aberturas de e-mail são notoriamente infladas por scanners de segurança
      // corporativos e pré-carregamento de imagens dos provedores. NÃO promovemos
      // o lead automaticamente por causa disso — apenas sinalizamos alto
      // engajamento (>= 5 aberturas) para revisão manual pela equipe.
      if (nextOpenCount >= 5 && send.lead_id) {
        try {
          await supabase
            .from('leads')
            .update({ alto_engajamento_email: true })
            .eq('id', send.lead_id);
        } catch (e) {
          // coluna pode não existir em ambientes antigos; ignora silenciosamente
          console.warn('alto_engajamento_email update skipped:', e);
        }
      }
    }

    return new Response(TRACKING_PIXEL, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('Tracking error:', error);
    return new Response(TRACKING_PIXEL, {
      headers: { 'Content-Type': 'image/gif', ...corsHeaders },
    });
  }
});
