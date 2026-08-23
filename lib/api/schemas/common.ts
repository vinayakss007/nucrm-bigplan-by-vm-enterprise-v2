/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';

// ── Common helpers (re-exported for use by other schema modules) ──
export const uuid = z.string().uuid().optional().nullable().or(z.literal(''));
export const requiredString = z.string().trim().min(1);
export const _optionalString = z.string().trim();
export const _optionalDate = z.string().datetime().optional().nullable();
export const _optionalNumber = z.number().optional().nullable();

// Accept URLs with or without protocol — auto-prepend https://
export const urlField = z.string().max(500).optional().nullable().or(z.literal('')).transform(v => {
  if (!v) return v;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  return `https://${v}`;
});
