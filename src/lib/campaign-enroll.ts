import { supabase } from '@/integrations/supabase/client';

/**
 * Enrolls a lead in an email flow by slug (email_flows table).
 * Creates one email_flow_recipients row and one email_sends row per step
 * with scheduled_for = now + delay_days.
 * No-op (returns {enrolled:false, reason}) if the flow does not exist / is not active
 * or the lead is already enrolled with a pending/sent state.
 */
export async function enrollLeadInFlow(
  leadId: string,
  flowSlug: string,
  sdrId: string,
): Promise<{ enrolled: boolean; reason?: string }> {
  const { data: flow, error: flowErr } = await supabase
    .from('email_flows')
    .select('id, status')
    .eq('slug', flowSlug)
    .maybeSingle();

  if (flowErr) return { enrolled: false, reason: flowErr.message };
  if (!flow) return { enrolled: false, reason: `Fluxo "${flowSlug}" não encontrado` };
  if (flow.status !== 'ativa') return { enrolled: false, reason: 'Fluxo não está ativo' };

  const { data: existing } = await supabase
    .from('email_flow_recipients')
    .select('id, status')
    .eq('flow_id', flow.id)
    .eq('lead_id', leadId)
    .in('status', ['pending', 'sent'])
    .limit(1);
  if (existing && existing.length > 0) return { enrolled: false, reason: 'Já inscrito' };

  const { data: steps } = await supabase
    .from('email_flow_steps')
    .select('id, delay_days')
    .eq('flow_id', flow.id)
    .order('order_index', { ascending: true });
  if (!steps || steps.length === 0) return { enrolled: false, reason: 'Fluxo sem passos' };

  const { data: lead } = await supabase
    .from('leads')
    .select('email')
    .eq('id', leadId)
    .maybeSingle();

  const { data: recipient, error: rErr } = await supabase
    .from('email_flow_recipients')
    .insert({ flow_id: flow.id, lead_id: leadId, status: 'pending', current_step_id: steps[0].id })
    .select('id')
    .single();
  if (rErr) return { enrolled: false, reason: rErr.message };

  const now = new Date();
  const rows = steps.map((s) => ({
    flow_id: flow.id,
    flow_step_id: s.id,
    recipient_id: recipient.id,
    lead_id: leadId,
    sdr_id: sdrId,
    to_email: lead?.email ?? null,
    scheduled_for: new Date(now.getTime() + (s.delay_days || 0) * 86400000).toISOString(),
    status: 'pending' as const,
  }));
  const { error } = await supabase.from('email_sends').insert(rows);
  if (error) return { enrolled: false, reason: error.message };
  return { enrolled: true };
}

/** Backward-compatible alias so existing callers keep working. */
export const enrollLeadInCampaign = enrollLeadInFlow;
