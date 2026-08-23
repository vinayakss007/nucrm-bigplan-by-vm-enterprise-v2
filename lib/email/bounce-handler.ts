/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * D2: Bounce Classification
 *
 * Classifies email bounces as HARD (permanent — disable address) or SOFT
 * (temporary — retry later) based on SMTP diagnostic codes.
 */

export enum BounceType {
  HARD = 'hard',
  SOFT = 'soft',
}

interface BounceInput {
  diagnosticCode: string;
  smtpCode: number;
  enhancedCode?: string;
}

interface BounceClassification {
  type: BounceType;
  reason: string;
  shouldDisable: boolean;
}

const HARD_BOUNCE_PATTERNS = [
  /does not exist/i,
  /user unknown/i,
  /no such user/i,
  /invalid recipient/i,
  /mailbox not found/i,
  /user not local/i,
  /account.*disabled/i,
  /mailbox.*disabled/i,
  /recipient.*rejected/i,
  /unrouteable/i,
];

const CRITICAL_PATTERNS = [
  /blocked/i,
  /blacklist/i,
  /spam.*block/i,
  /policy.*reject/i,
  /your ip.*has been/i,
];

const SMTP_HARD_CODES = new Set([510, 511, 512, 513, 514, 516]);
const SMTP_HARD_ENHANCED = new Set(['5.1.0', '5.1.1', '5.1.2', '5.1.3', '5.1.4', '5.1.5', '5.1.6']);
const SMTP_HARD_ACCOUNT = new Set(['5.2.1', '5.2.2']);

function isHardBounce(input: BounceInput): { hard: boolean; critical: boolean; reason: string } {
  // Check enhanced code first (most reliable)
  if (input.enhancedCode) {
    if (SMTP_HARD_ENHANCED.has(input.enhancedCode)) {
      return { hard: true, critical: false, reason: `Enhanced code ${input.enhancedCode} — permanent failure` };
    }
    if (SMTP_HARD_ACCOUNT.has(input.enhancedCode)) {
      return { hard: true, critical: false, reason: `Enhanced code ${input.enhancedCode} — account issue` };
    }
  }

  // Check SMTP code
  if (SMTP_HARD_CODES.has(input.smtpCode)) {
    return { hard: true, critical: false, reason: `SMTP ${input.smtpCode} — permanent failure` };
  }

  // Check diagnostic code patterns
  const isCritical = CRITICAL_PATTERNS.some(p => p.test(input.diagnosticCode));
  if (isCritical) {
    return { hard: true, critical: true, reason: `Critical: ${input.diagnosticCode}` };
  }

  const isHardPattern = HARD_BOUNCE_PATTERNS.some(p => p.test(input.diagnosticCode));
  if (isHardPattern) {
    return { hard: true, critical: false, reason: input.diagnosticCode };
  }

  return { hard: false, critical: false, reason: input.diagnosticCode };
}

export function classifyBounce(input: BounceInput): BounceClassification {
  const { hard, critical, reason } = isHardBounce(input);

  if (hard) {
    return {
      type: BounceType.HARD,
      reason,
      shouldDisable: critical,
    };
  }

  return {
    type: BounceType.SOFT,
    reason: reason || 'Temporary failure',
    shouldDisable: false,
  };
}

interface BounceRecord {
  type: BounceType;
  count: number;
}

const HARD_BOUNCE_DISABLE_THRESHOLD = 3;

/**
 * Determines if a sending address should be disabled based on bounce history.
 * Returns true after 3 consecutive hard bounces.
 */
export function shouldDisableAddress(bounces: BounceRecord[]): boolean {
  const consecutiveHard = bounces
    .filter(b => b.type === BounceType.HARD)
    .length;

  return consecutiveHard >= HARD_BOUNCE_DISABLE_THRESHOLD;
}
