import { z } from 'zod';
import { urlField } from './common';

// ── Profile update schema ──
export const updateProfileSchema = z.object({
  first_name: z.string().trim().max(100).nullable().optional(),
  last_name: z.string().trim().max(100).nullable().optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  avatar_url: urlField,
  timezone: z.string().trim().max(50).nullable().optional(),
  language: z.string().trim().max(10).nullable().optional(),
});

// ── Telegram Settings schema ──
export const updateTelegramSchema = z.object({
  telegram_bot_token: z.string().trim().max(200).optional().nullable(),
  telegram_chat_id: z.string().trim().max(100).optional().nullable(),
  telegram_enabled: z.boolean().optional(),
  telegram_notify_login: z.boolean().optional(),
  telegram_notify_signup: z.boolean().optional(),
  telegram_notify_password_change: z.boolean().optional(),
  telegram_notify_2fa_change: z.boolean().optional(),
  telegram_notify_security_alerts: z.boolean().optional(),
  action: z.enum(['test']).optional(),
});

// ── Notification preference schemas ──
export const updateNotificationPrefsSchema = z.object({
  email_notifications: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  notification_frequency: z.enum(['instant', 'hourly', 'daily', 'weekly']).optional(),
  notify_on_contact_created: z.boolean().optional(),
  notify_on_deal_won: z.boolean().optional(),
  notify_on_ticket_created: z.boolean().optional(),
  notify_on_task_due: z.boolean().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

// ── Preferences patch schema ──
export const preferencesPatchSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  font_size: z.enum(['small', 'normal', 'large', 'xl']).optional(),
  ui_density: z.enum(['compact', 'cozy', 'comfy']).optional(),
  accent_color: z.enum(['violet', 'indigo', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'slate']).optional(),
  sidebar_default: z.enum(['expanded', 'collapsed']).optional(),
  date_format: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).optional(),
  time_format: z.enum(['12h', '24h']).optional(),
  week_start: z.enum(['sunday', 'monday']).optional(),
  default_landing: z.string().optional(),
  default_record_view: z.enum(['list', 'kanban', 'calendar', 'card']).optional(),
  default_page_size: z.number().int().min(10).max(100).optional(),
  confirm_destructive: z.enum(['always', 'danger_only', 'never']).optional(),
  default_calendar_view: z.enum(['day', 'week', 'month', 'agenda']).optional(),
  email_tracking_default: z.enum(['on', 'off', 'ask']).optional(),
  default_meeting_duration: z.number().int().min(15).max(90).optional(),
  online_status_visible: z.enum(['everyone', 'team', 'nobody']).optional(),
  activity_visible_to: z.enum(['everyone', 'team', 'managers', 'nobody']).optional(),
  reduce_motion: z.boolean().optional(),
  high_contrast: z.boolean().optional(),
  show_avatars: z.boolean().optional(),
  links_open_new_tab: z.boolean().optional(),
  keyboard_shortcuts_enabled: z.boolean().optional(),
  sticky_filters: z.boolean().optional(),
  show_tips: z.boolean().optional(),
  autosave_drafts: z.boolean().optional(),
  show_keyboard_hints: z.boolean().optional(),
  email_signature: z.string().max(5000).optional(),
  auto_cc_self: z.boolean().optional(),
  hidden_nav_items: z.array(z.string().max(200)).max(200).optional(),
});

// ── Type exports ──
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateTelegramInput = z.infer<typeof updateTelegramSchema>;
