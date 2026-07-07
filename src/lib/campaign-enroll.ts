import { supabase } from '@/integrations/supabase/client';

/**
 * Enrolls a lead in an email campaign by slug.
 * Creates one email_sends row per email_step with scheduled_for = now + delay_days.
 * No-op (returns false) if the campaign does not exist or the lead is already actively enrolled.
 */
export async function enrollLeadInCampaign(
  leadId: string,
  campaignSlug: string,
  sdrId: string,
): Promise<{ enrolled: boolean; reason?: string }> {
  const { data: campaign } = await supabase
    .from('email_campaigns')
    .select('id, status')
    .eq('slug', campaignSlug)
    .maybeSingle();

  if (!campaign) return { enrolled: false, reason: `Campaign "${campaignSlug}" not found` };
  if (campaign.status !== 'active') return { enrolled: false, reason: 'Campaign not active' };

  const { data: existing } = await supabase
    .from('email_sends')
    .select('id')
    .eq('lead_id', leadId)
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'sent'])
    .limit(1);

  if (existing && existing.length > 0) {
    return { enrolled: false, reason: 'Already enrolled' };
  }

  const { data: steps } = await supabase
    .from('email_steps')
    .select('id, delay_days')
    .eq('campaign_id', campaign.id)
    .order('step_order', { ascending: true });

  if (!steps || steps.length === 0) return { enrolled: false, reason: 'No steps' };

  const now = new Date();
  const rows = steps.map(s => ({
    lead_id: leadId,
    campaign_id: campaign.id,
    step_id: s.id,
    sdr_id: sdrId,
    scheduled_for: new Date(now.getTime() + (s.delay_days || 0) * 86400000).toISOString(),
    status: 'pending' as const,
  }));

  const { error } = await supabase.from('email_sends').insert(rows);
  if (error) return { enrolled: false, reason: error.message };
  return { enrolled: true };
}
