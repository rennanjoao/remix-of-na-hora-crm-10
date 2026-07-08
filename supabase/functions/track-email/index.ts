import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildCorsHeaders } from '../_shared/cors.ts'


// 1x1 transparent GIF pixel
const TRACKING_PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

Deno.serve(async (req) => {
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

    // Update open count
    const { data: send, error: fetchError } = await supabase
      .from('email_sends')
      .select('id, open_count, lead_id, campaign_id')
      .eq('tracking_id', trackingId)
      .maybeSingle();

    if (send && !fetchError) {
      await supabase
        .from('email_sends')
        .update({
          open_count: send.open_count + 1,
          last_opened_at: new Date().toISOString(),
          status: 'aberto',
        })
        .eq('id', send.id);

      // If 5+ opens, move lead to "qualificado" (interested)
      if (send.open_count + 1 >= 5) {
        await supabase
          .from('leads')
          .update({ status: 'qualificado' })
          .eq('id', send.lead_id);
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
