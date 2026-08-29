import { describe, it, expect } from 'vitest';
import {
  getTokenExpiry,
  isTokenExpired,
  isStaleTokenResponse,
  TOKEN_EXPIRY_SKEW_MS,
} from '@/lib/whatsapp/token';

describe('whatsapp token expiry helpers (#1294)', () => {
  const NOW = 1_700_000_000_000; // fixed reference time

  describe('getTokenExpiry', () => {
    it('returns null when no expiry is stored', () => {
      expect(getTokenExpiry(undefined)).toBeNull();
      expect(getTokenExpiry(null)).toBeNull();
      expect(getTokenExpiry({})).toBeNull();
      expect(getTokenExpiry({ access_token: 'x' })).toBeNull();
      expect(getTokenExpiry({ token_expires_at: '' })).toBeNull();
    });

    it('parses token_expires_at (ISO string)', () => {
      const iso = new Date(NOW).toISOString();
      expect(getTokenExpiry({ token_expires_at: iso })?.getTime()).toBe(NOW);
    });

    it('falls back to expires_at when token_expires_at is absent', () => {
      const iso = new Date(NOW).toISOString();
      expect(getTokenExpiry({ expires_at: iso })?.getTime()).toBe(NOW);
    });

    it('accepts numeric epoch millis', () => {
      expect(getTokenExpiry({ token_expires_at: NOW })?.getTime()).toBe(NOW);
    });

    it('returns null for an unparseable value', () => {
      expect(getTokenExpiry({ token_expires_at: 'not-a-date' })).toBeNull();
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when no expiry is stored (fall back to reactive detection)', () => {
      expect(isTokenExpired({ access_token: 'x' }, NOW)).toBe(false);
    });

    it('returns false for a token comfortably in the future', () => {
      const future = new Date(NOW + 10 * 60_000).toISOString();
      expect(isTokenExpired({ token_expires_at: future }, NOW)).toBe(false);
    });

    it('returns true for an already-expired token', () => {
      const past = new Date(NOW - 60_000).toISOString();
      expect(isTokenExpired({ token_expires_at: past }, NOW)).toBe(true);
    });

    it('treats a token within the skew buffer as expired', () => {
      const almost = new Date(NOW + TOKEN_EXPIRY_SKEW_MS - 1).toISOString();
      expect(isTokenExpired({ token_expires_at: almost }, NOW)).toBe(true);
    });

    it('does not treat a token just beyond the skew buffer as expired', () => {
      const beyond = new Date(NOW + TOKEN_EXPIRY_SKEW_MS + 1000).toISOString();
      expect(isTokenExpired({ token_expires_at: beyond }, NOW)).toBe(false);
    });
  });

  describe('isStaleTokenResponse', () => {
    it('flags HTTP 401 as stale', () => {
      expect(isStaleTokenResponse(401)).toBe(true);
    });

    it('flags Meta OAuthException codes 190/102/463', () => {
      expect(isStaleTokenResponse(400, 190)).toBe(true);
      expect(isStaleTokenResponse(400, 102)).toBe(true);
      expect(isStaleTokenResponse(400, '463')).toBe(true);
    });

    it('does not flag unrelated errors', () => {
      expect(isStaleTokenResponse(400, 131_026)).toBe(false);
      expect(isStaleTokenResponse(500)).toBe(false);
      expect(isStaleTokenResponse(429, undefined)).toBe(false);
    });
  });
});
