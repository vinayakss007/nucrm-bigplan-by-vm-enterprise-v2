/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Pale category tints for the landing page's integration wall and module rail.
 * The saturation stays low so the logos read as colour without breaking the
 * warm editorial palette.
 */
import type { CSSProperties } from 'react';

const DEFAULT_CONNECTOR_TINT = { ink: '#475569', rgb: '100 116 139' };

const CONNECTOR_TINT: Record<string, { ink: string; rgb: string }> = {
  'Email delivery': { ink: '#b45309', rgb: '217 119 6' },
  'Mailbox sync': { ink: '#2563eb', rgb: '59 130 246' },
  Messaging: { ink: '#0f9f6e', rgb: '16 185 129' },
  'Chat-ops': { ink: '#7c3aed', rgb: '139 92 246' },
  Payments: { ink: '#4f46e5', rgb: '99 102 241' },
  'AI providers': { ink: '#c2410c', rgb: '234 88 12' },
  Calendar: { ink: '#0284c7', rgb: '14 165 233' },
  Identity: { ink: '#0d9488', rgb: '20 184 166' },
  Events: { ink: '#ea580c', rgb: '249 115 22' },
  Platform: DEFAULT_CONNECTOR_TINT,
  Capture: { ink: '#db2777', rgb: '236 72 153' },
};

export function connectorTint(category: string): CSSProperties {
  const tint = CONNECTOR_TINT[category] ?? DEFAULT_CONNECTOR_TINT;
  return {
    '--logo-ink': tint.ink,
    '--logo-wash': `rgb(${tint.rgb} / 0.09)`,
    '--logo-wash-strong': `rgb(${tint.rgb} / 0.16)`,
    '--logo-line': `rgb(${tint.rgb} / 0.24)`,
    '--logo-orb': `rgb(${tint.rgb} / 0.15)`,
  } as CSSProperties;
}

export const MODULE_TINT: Record<string, string> = {
  Core: '#2563eb',
  Dashboard: '#64748b',
  Automation: '#d97706',
  Messaging: '#0f9f6e',
  AI: '#b45309',
  Analytics: '#0891b2',
  Revenue: '#c2410c',
  Governance: '#475569',
};
