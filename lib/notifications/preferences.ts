/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Shared notification preference vocabulary (#4087).
 *
 * The matrix UI (`app/api/tenant/notifications/matrix`) owns the stored shape;
 * delivery paths read the same defaults and resolver so an unchecked channel
 * actually suppresses that channel instead of being cosmetic.
 */
export const CHANNELS = ['in_app', 'email', 'telegram'] as const;
export type Channel = typeof CHANNELS[number];

export const EVENT_KEYS = new Set([
  'lead.created', 'lead.assigned_to_me', 'lead.status_changed',
  'contact.created', 'contact.mentioned_me',
  'deal.created', 'deal.assigned_to_me', 'deal.stage_changed',
  'deal.won', 'deal.lost', 'deal.close_date_approaching',
  'task.assigned_to_me', 'task.due_today', 'task.overdue',
  'ticket.created', 'ticket.assigned_to_me', 'ticket.replied',
  'comment.mentioned_me', 'comment.replied',
  'team.invite_accepted', 'team.role_changed',
  'security.login_new_device', 'security.password_changed', 'security.two_factor_changed',
  'billing.trial_ending', 'billing.payment_failed', 'billing.plan_changed',
  'contract.expiring', 'contract.expired', 'contract.renewed',
]);

export const DEFAULTS: Record<string, Record<Channel, boolean>> = Object.fromEntries(
  Array.from(EVENT_KEYS).map(key => {
    const personal = /assigned_to_me|mentioned_me|due_today|overdue|replied|won|lost|approaching/.test(key);
    const security = key.startsWith('security.');
    const billing = key.startsWith('billing.');
    const contract = key.startsWith('contract.');
    return [key, {
      in_app: true,
      email: personal || security || billing || contract,
      telegram: false,
    }];
  })
) as Record<string, Record<Channel, boolean>>;

const TYPE_TO_EVENT: Record<string, string> = {
  task_assigned: 'task.assigned_to_me',
  task_due: 'task.due_today',
  task_overdue: 'task.overdue',
  deal_stage: 'deal.stage_changed',
  deal_assigned: 'deal.assigned_to_me',
  deal_won: 'deal.won',
  contact_assigned: 'contact.created',
  mention: 'comment.mentioned_me',
  invite_accepted: 'team.invite_accepted',
  team_joined: 'team.invite_accepted',
  limit_warning: 'billing.plan_changed',
  trial_expiring: 'billing.trial_ending',
  contract_renewal: 'contract.renewed',
  subscription_renewal: 'billing.plan_changed',
};

export function eventKeyForNotificationType(type: string): string | null {
  return TYPE_TO_EVENT[type] ?? null;
}

export function matrixFromPrefs(prefs: unknown): Record<string, Record<Channel, boolean>> {
  const stored = ((prefs as Record<string, unknown> | null)?.['matrix'] ?? {}) as Record<string, Record<Channel, boolean>>;
  return stored && typeof stored === 'object' ? stored : {};
}

/** Missing prefs and unmapped types keep the historical behaviour (deliver). */
export function channelEnabled(
  matrix: Record<string, Record<Channel, boolean>>,
  type: string,
  channel: Channel,
): boolean {
  const key = eventKeyForNotificationType(type);
  if (!key || !EVENT_KEYS.has(key)) return true;
  const def = DEFAULTS[key]![channel];
  const value = matrix[key]?.[channel];
  return typeof value === 'boolean' ? value : def;
}
