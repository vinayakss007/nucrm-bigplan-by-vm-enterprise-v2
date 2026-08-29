/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Assertion + reporting utilities for the #1477 billing-lifecycle harness.
 *
 * These helpers RETURN a Check result rather than throwing, so the harness can
 * run every lifecycle step, collect results, and emit a single PASS/FAIL
 * report at the end. Also provides `redact` so no secret/key/PAN is ever
 * logged in full. Dependency-free and pure.
 */

/** Result of a single lifecycle assertion. */
export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/** Assert two values are deeply equal (via JSON comparison for objects). */
export function assertEqual(name: string, actual: unknown, expected: unknown): Check {
  const pass = actual === expected || stableStringify(actual) === stableStringify(expected);
  if (pass) {
    return { name, pass: true };
  }
  return {
    name,
    pass: false,
    detail: `expected ${stableStringify(expected)}, got ${stableStringify(actual)}`,
  };
}

/** Assert a value is one of the allowed values. */
export function assertOneOf(name: string, actual: unknown, allowed: readonly unknown[]): Check {
  const pass = allowed.some((candidate) => candidate === actual);
  if (pass) {
    return { name, pass: true };
  }
  return {
    name,
    pass: false,
    detail: `expected one of ${stableStringify(allowed)}, got ${stableStringify(actual)}`,
  };
}

/** Assert a boolean condition is true. */
export function assertTrue(name: string, condition: boolean, detail?: string): Check {
  if (condition) {
    return { name, pass: true };
  }
  return { name, pass: false, detail: detail ?? 'condition was false' };
}

/** Format a Check as a single human-readable PASS/FAIL line. */
export function formatCheck(check: Check): string {
  const label = check.pass ? 'PASS' : 'FAIL';
  const suffix = check.detail ? ` — ${check.detail}` : '';
  return `[${label}] ${check.name}${suffix}`;
}

/** Summarize a list of checks into pass/fail counts. */
export function summarize(checks: readonly Check[]): {
  passed: number;
  failed: number;
  allPassed: boolean;
} {
  let passed = 0;
  let failed = 0;
  for (const check of checks) {
    if (check.pass) {
      passed += 1;
    } else {
      failed += 1;
    }
  }
  return { passed, failed, allPassed: failed === 0 };
}

/**
 * Mask all but the last 4 characters of a sensitive value so secrets, keys and
 * card PANs are never logged in full. Short values are fully masked.
 */
export function redact(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  const visible = value.slice(-4);
  return `${'*'.repeat(value.length - 4)}${visible}`;
}

function stableStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
