/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The value layer of the workflow executor: condition operators, context lookups
 * and `{{var}}` interpolation.
 *
 * These four are pure — no db, no graph, no side effects — so they live apart
 * from `workflow-executor.ts`, whose walk is only ever testable through a db
 * mock. Keeping them here is also what lets the executor stay under the
 * #1843/#422 file-size ratchet (#3139).
 */

import { escapeHtml } from '@/lib/email/escape-html';

export function evaluateCondition(fieldValue: unknown, operator: string, value: unknown): boolean {
  switch (operator) {
    case 'equals': return String(fieldValue) === String(value);
    case 'not_equals': return String(fieldValue) !== String(value);
    case 'contains': return String(fieldValue ?? '').includes(String(value));
    case 'not_contains': return !String(fieldValue ?? '').includes(String(value));
    case 'greater_than': return Number(fieldValue) > Number(value);
    case 'less_than': return Number(fieldValue) < Number(value);
    case 'is_empty': return fieldValue == null || fieldValue === '';
    case 'is_not_empty': return fieldValue != null && fieldValue !== '';
    default: return false;
  }
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function interpolate(template: string, data: Record<string, unknown>, opts?: { escapeValues?: boolean }): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = String(data[key] ?? '');
    return opts?.escapeValues ? escapeHtml(value) : value;
  });
}

/**
 * Like interpolate(), but HTML-escapes each substituted value.
 * MUST be used whenever the result is rendered as HTML (e.g. email bodies)
 * to prevent XSS via user-controlled template variables.
 */
export function interpolateHtml(template: string, data: Record<string, unknown>): string {
  return interpolate(template, data, { escapeValues: true });
}
