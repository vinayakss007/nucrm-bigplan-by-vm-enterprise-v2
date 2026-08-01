import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDiallerSession,
  getNextContact,
  logCallOutcome,
  getSessionStats,
  skipContact,
  pauseSession,
  resumeSession,
  _resetStore,
} from '@/lib/dialler/power-dialler';
import type { CallOutcome } from '@/lib/dialler/power-dialler';

describe('Power Dialler Engine', () => {
  beforeEach(() => {
    _resetStore();
  });

  describe('createDiallerSession', () => {
    it('creates a session with correct initial state', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2', 'c-3']);

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.tenantId).toBe('tenant-1');
      expect(session.contacts).toEqual(['c-1', 'c-2', 'c-3']);
      expect(session.currentIndex).toBe(0);
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it('throws if userId is empty', () => {
      expect(() => createDiallerSession('', 'tenant-1', ['c-1'])).toThrow('userId is required');
    });

    it('throws if tenantId is empty', () => {
      expect(() => createDiallerSession('user-1', '', ['c-1'])).toThrow('tenantId is required');
    });

    it('throws if contactIds is empty', () => {
      expect(() => createDiallerSession('user-1', 'tenant-1', [])).toThrow(
        'contactIds must be a non-empty array'
      );
    });

    it('does not mutate the original contactIds array', () => {
      const ids = ['c-1', 'c-2'];
      const session = createDiallerSession('user-1', 'tenant-1', ids);
      session.contacts.push('c-3');
      expect(ids).toEqual(['c-1', 'c-2']);
    });
  });

  describe('getNextContact', () => {
    it('returns first contact initially', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2']);
      const next = getNextContact(session.id);

      expect(next).not.toBeNull();
      expect(next!.contactId).toBe('c-1');
      expect(next!.index).toBe(0);
      expect(next!.remaining).toBe(1);
    });

    it('returns null when all contacts are exhausted', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      logCallOutcome(session.id, 'c-1', 'connected', 30, null);
      const next = getNextContact(session.id);
      expect(next).toBeNull();
    });

    it('throws for invalid session ID', () => {
      expect(() => getNextContact('nonexistent')).toThrow('Session not found');
    });

    it('throws when session is paused', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2']);
      pauseSession(session.id);
      expect(() => getNextContact(session.id)).toThrow('Session is paused');
    });
  });

  describe('logCallOutcome', () => {
    it('logs a connected call and advances index', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2', 'c-3']);
      const log = logCallOutcome(session.id, 'c-1', 'connected', 120, 'Good conversation');

      expect(log.sessionId).toBe(session.id);
      expect(log.contactId).toBe('c-1');
      expect(log.outcome).toBe('connected');
      expect(log.duration).toBe(120);
      expect(log.notes).toBe('Good conversation');
      expect(log.loggedAt).toBeInstanceOf(Date);

      const next = getNextContact(session.id);
      expect(next!.contactId).toBe('c-2');
    });

    it('marks session completed when last contact is logged', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      logCallOutcome(session.id, 'c-1', 'voicemail', 15, null);

      expect(session.status).toBe('completed');
    });

    it('throws for invalid outcome', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      expect(() => logCallOutcome(session.id, 'c-1', 'invalid' as CallOutcome, 0, null)).toThrow(
        'Invalid outcome'
      );
    });

    it('throws for negative duration', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      expect(() => logCallOutcome(session.id, 'c-1', 'connected', -5, null)).toThrow(
        'Duration cannot be negative'
      );
    });

    it('throws for invalid session ID', () => {
      expect(() => logCallOutcome('bad-id', 'c-1', 'connected', 10, null)).toThrow(
        'Session not found'
      );
    });
  });

  describe('getSessionStats', () => {
    it('returns zeroed stats for a fresh session', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2', 'c-3']);
      const stats = getSessionStats(session.id);

      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(0);
      expect(stats.connected).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });

    it('correctly computes stats after multiple calls', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2', 'c-3', 'c-4']);
      logCallOutcome(session.id, 'c-1', 'connected', 120, null);
      logCallOutcome(session.id, 'c-2', 'no_answer', 0, null);
      logCallOutcome(session.id, 'c-3', 'connected', 60, null);

      const stats = getSessionStats(session.id);
      expect(stats.total).toBe(4);
      expect(stats.completed).toBe(3);
      expect(stats.connected).toBe(2);
      expect(stats.avgDuration).toBe(60); // (120 + 0 + 60) / 3 = 60
    });

    it('throws for invalid session ID', () => {
      expect(() => getSessionStats('nonexistent')).toThrow('Session not found');
    });
  });

  describe('skipContact', () => {
    it('skips a contact and advances to next', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2', 'c-3']);
      const record = skipContact(session.id, 'c-1', 'Not available');

      expect(record.contactId).toBe('c-1');
      expect(record.reason).toBe('Not available');
      expect(record.skippedAt).toBeInstanceOf(Date);

      const next = getNextContact(session.id);
      expect(next!.contactId).toBe('c-2');
    });

    it('marks session completed when last contact is skipped', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      skipContact(session.id, 'c-1', 'Out of office');
      expect(session.status).toBe('completed');
    });

    it('throws if reason is empty', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      expect(() => skipContact(session.id, 'c-1', '')).toThrow('Skip reason is required');
    });

    it('throws for invalid session ID', () => {
      expect(() => skipContact('bad-id', 'c-1', 'reason')).toThrow('Session not found');
    });
  });

  describe('pauseSession / resumeSession', () => {
    it('pauses an active session', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2']);
      const paused = pauseSession(session.id);
      expect(paused.status).toBe('paused');
    });

    it('resumes a paused session', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2']);
      pauseSession(session.id);
      const resumed = resumeSession(session.id);
      expect(resumed.status).toBe('active');
    });

    it('throws when pausing a completed session', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      logCallOutcome(session.id, 'c-1', 'connected', 60, null);
      expect(() => pauseSession(session.id)).toThrow('Cannot pause a completed session');
    });

    it('throws when resuming a non-paused session', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1']);
      expect(() => resumeSession(session.id)).toThrow('Can only resume a paused session');
    });

    it('allows getting next contact after resume', () => {
      const session = createDiallerSession('user-1', 'tenant-1', ['c-1', 'c-2']);
      pauseSession(session.id);
      resumeSession(session.id);
      const next = getNextContact(session.id);
      expect(next!.contactId).toBe('c-1');
    });
  });
});
