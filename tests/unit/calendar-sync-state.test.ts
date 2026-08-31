/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for lib/calendar-sync/state.ts — signed OAuth state (#1175).
 *
 * Covers issue #672 (test-coverage epic): this module guards the calendar
 * connect flow against forged OAuth `state` values. The security property
 * under test is that only a value produced by signOAuthState() with the
 * configured secret can pass verifyOAuthState().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { signOAuthState, verifyOAuthState } from '@/lib/calendar-sync/state';

const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET;
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

function restoreEnv() {
  if (ORIGINAL_SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET;
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
}

describe('calendar-sync OAuth state', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('signOAuthState + verifyOAuthState round-trip', () => {
    it('verifies a freshly signed payload', () => {
      const signed = signOAuthState('tenant-123:google');
      expect(signed).toContain('.');
      expect(verifyOAuthState(signed)).toBe(true);
    });

    it('produces a stable signature for the same payload + secret', () => {
      expect(signOAuthState('same')).toBe(signOAuthState('same'));
    });

    it('produces different signatures for different payloads', () => {
      expect(signOAuthState('a')).not.toBe(signOAuthState('b'));
    });

    it('round-trips payloads containing special/unicode characters', () => {
      const payload = 'tenant/42?x=1&y=2 café 🎉';
      expect(verifyOAuthState(signOAuthState(payload))).toBe(true);
    });

    it('round-trips an empty payload (non-empty signed output, still valid)', () => {
      const signed = signOAuthState('');
      // Empty payload decodes to '' which verify treats as invalid.
      expect(verifyOAuthState(signed)).toBe(false);
    });
  });

  describe('forgery / tampering rejection', () => {
    it('rejects a tampered payload segment', () => {
      const signed = signOAuthState('tenant-123:google');
      const [, sig] = signed.split('.');
      const forgedPayload = Buffer.from('tenant-999:google').toString('base64url');
      expect(verifyOAuthState(`${forgedPayload}.${sig}`)).toBe(false);
    });

    it('rejects a tampered signature segment', () => {
      const signed = signOAuthState('tenant-123:google');
      const [payload] = signed.split('.');
      expect(verifyOAuthState(`${payload}.deadbeef`)).toBe(false);
    });

    it('rejects a signature produced with a different secret', () => {
      const payload = 'tenant-123:google';
      const payloadB64 = Buffer.from(payload).toString('base64url');
      const wrongSig = createHmac('sha256', 'attacker-secret').update(payload).digest('base64url');
      expect(verifyOAuthState(`${payloadB64}.${wrongSig}`)).toBe(false);
    });

    it('rejects when the verifying secret differs from the signing secret', () => {
      const signed = signOAuthState('tenant-123:google');
      process.env.SESSION_SECRET = 'rotated-secret';
      expect(verifyOAuthState(signed)).toBe(false);
    });
  });

  describe('malformed / empty input', () => {
    it('rejects an empty string', () => {
      expect(verifyOAuthState('')).toBe(false);
    });

    it('rejects a value with no dot separator (unsigned payload)', () => {
      expect(verifyOAuthState(signOAuthState('x').split('.')[0]!)).toBe(false);
    });

    it('rejects a value that starts with a dot', () => {
      expect(verifyOAuthState('.somesig')).toBe(false);
    });

    it('rejects a value whose payload decodes to empty', () => {
      const emptyPayloadB64 = Buffer.from('').toString('base64url'); // ''
      expect(verifyOAuthState(`${emptyPayloadB64}.sig`)).toBe(false);
    });
  });

  describe('secret configuration', () => {
    it('falls back to unsigned (no dot) when no secret is configured', () => {
      delete process.env.SESSION_SECRET;
      delete process.env.JWT_SECRET;
      const signed = signOAuthState('tenant-123');
      expect(signed).not.toContain('.');
    });

    it('verify returns false when no secret is configured, even for signed input', () => {
      const signed = signOAuthState('tenant-123'); // signed with SESSION_SECRET
      delete process.env.SESSION_SECRET;
      delete process.env.JWT_SECRET;
      expect(verifyOAuthState(signed)).toBe(false);
    });

    it('falls back to JWT_SECRET when SESSION_SECRET is absent', () => {
      delete process.env.SESSION_SECRET;
      process.env.JWT_SECRET = 'jwt-fallback-secret';
      const signed = signOAuthState('tenant-123:outlook');
      expect(signed).toContain('.');
      expect(verifyOAuthState(signed)).toBe(true);
    });
  });
});
