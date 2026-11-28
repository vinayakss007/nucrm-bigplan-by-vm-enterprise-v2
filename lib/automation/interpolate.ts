/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { escapeHtml } from '@/lib/email/escape-html';

export function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return v == null ? undefined : String(v);
}

export function interpolate(template: string, data: Record<string, unknown>, opts?: { escapeValues?: boolean }): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = String(data[key] ?? '');
    return opts?.escapeValues ? escapeHtml(value) : value;
  });
}

export function interpolateHtml(template: string, data: Record<string, unknown>): string {
  return interpolate(template, data, { escapeValues: true });
}
