import { supabase } from '@/integrations/supabase/client';

export type LeadActivityType =
  | 'status_change'
  | 'note_added'
  | 'email_sent'
  | 'call_made'
  | 'viewed'
  | 'meeting_scheduled'
  | 'lead_created'
  | 'lead_imported'
  | 'whatsapp_sent'
  | 'campaign_enrolled'
  | 'field_updated';

export interface LogActivityArgs {
  leadId: string;
  userId: string | null;
  actionType: LeadActivityType;
  description: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort insert into lead_activities. Never throws — audit failures
 * must not break user-facing flows. Errors are logged to console.
 */
export async function logLeadActivity(args: LogActivityArgs): Promise<void> {
  try {
    // Types not yet regenerated for lead_activities → cast client to unknown.
    const { error } = await (supabase.from as unknown as (t: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
    })('lead_activities').insert({
      lead_id: args.leadId,
      user_id: args.userId,
      action_type: args.actionType,
      description: args.description,
      previous_status: args.previousStatus ?? null,
      new_status: args.newStatus ?? null,
      metadata: args.metadata ?? null,
    });
    if (error) console.warn('[lead_activities] insert failed', error);
  } catch (err) {
    console.warn('[lead_activities] insert threw', err);
  }
}
