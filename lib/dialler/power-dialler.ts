/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Power Dialler Engine
 *
 * Manages call sessions for sales reps, cycling through a list of contacts
 * with disposition logging, skip controls, and session statistics.
 */

export type CallOutcome = 'connected' | 'voicemail' | 'no_answer' | 'busy' | 'wrong_number' | 'callback';

export type SessionStatus = 'active' | 'paused' | 'completed';

export interface DiallerSession {
  id: string;
  userId: string;
  tenantId: string;
  contacts: string[];
  currentIndex: number;
  status: SessionStatus;
  startedAt: Date;
}

export interface DiallerSettings {
  /** Auto-advance to next contact after logging outcome */
  autoAdvance?: boolean;
  /** Maximum call duration in seconds before auto-disconnect warning */
  maxCallDuration?: number;
  /** Cooldown between calls in milliseconds */
  cooldownMs?: number;
}

export interface CallLog {
  sessionId: string;
  contactId: string;
  outcome: CallOutcome;
  duration: number;
  notes: string | null;
  loggedAt: Date;
}

export interface SessionStats {
  total: number;
  completed: number;
  connected: number;
  avgDuration: number;
}

export interface SkipRecord {
  sessionId: string;
  contactId: string;
  reason: string;
  skippedAt: Date;
}

// ─── In-memory store (production would use DB/Redis) ────────

const sessions = new Map<string, DiallerSession>();
const callLogs = new Map<string, CallLog[]>();
const skipRecords = new Map<string, SkipRecord[]>();

/**
 * Create a new dialler session for a rep.
 *
 * @param userId - The sales rep starting the session
 * @param tenantId - Tenant context
 * @param contactIds - Ordered list of contact IDs to call
 * @param settings - Optional session settings
 * @returns The created session
 */
export function createDiallerSession(
  userId: string,
  tenantId: string,
  contactIds: string[],
  _settings?: DiallerSettings
): DiallerSession {
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!tenantId) {
    throw new Error('tenantId is required');
  }
  if (!contactIds || contactIds.length === 0) {
    throw new Error('contactIds must be a non-empty array');
  }

  const session: DiallerSession = {
    id: crypto.randomUUID(),
    userId,
    tenantId,
    contacts: [...contactIds],
    currentIndex: 0,
    status: 'active',
    startedAt: new Date(),
  };

  sessions.set(session.id, session);
  callLogs.set(session.id, []);
  skipRecords.set(session.id, []);

  return session;
}

/**
 * Get the next contact to call in the session.
 *
 * @param sessionId - The active session ID
 * @returns Contact ID and position info, or null if session is complete
 */
export function getNextContact(sessionId: string): {
  contactId: string;
  index: number;
  remaining: number;
} | null {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (session.status === 'paused') {
    throw new Error('Session is paused. Resume before getting next contact.');
  }

  if (session.status === 'completed' || session.currentIndex >= session.contacts.length) {
    session.status = 'completed';
    return null;
  }

  const contactId = session.contacts[session.currentIndex]!;
  const remaining = session.contacts.length - session.currentIndex - 1;

  return { contactId, index: session.currentIndex, remaining };
}

/**
 * Log the outcome of a call attempt.
 *
 * @param sessionId - The session ID
 * @param contactId - The contact that was called
 * @param outcome - The call disposition
 * @param duration - Call duration in seconds
 * @param notes - Optional notes from the rep
 * @returns The call log entry
 */
export function logCallOutcome(
  sessionId: string,
  contactId: string,
  outcome: CallOutcome,
  duration: number,
  notes: string | null
): CallLog {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const validOutcomes: CallOutcome[] = ['connected', 'voicemail', 'no_answer', 'busy', 'wrong_number', 'callback'];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}. Must be one of: ${validOutcomes.join(', ')}`);
  }

  if (duration < 0) {
    throw new Error('Duration cannot be negative');
  }

  const log: CallLog = {
    sessionId,
    contactId,
    outcome,
    duration,
    notes: notes || null,
    loggedAt: new Date(),
  };

  const logs = callLogs.get(sessionId) ?? [];
  logs.push(log);
  callLogs.set(sessionId, logs);

  // Advance to next contact
  session.currentIndex++;
  if (session.currentIndex >= session.contacts.length) {
    session.status = 'completed';
  }

  return log;
}

/**
 * Get statistics for a dialler session.
 *
 * @param sessionId - The session ID
 * @returns Aggregated session stats
 */
export function getSessionStats(sessionId: string): SessionStats {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const logs = callLogs.get(sessionId) ?? [];
  const total = session.contacts.length;
  const completed = logs.length;
  const connected = logs.filter((l) => l.outcome === 'connected').length;
  const totalDuration = logs.reduce((sum, l) => sum + l.duration, 0);
  const avgDuration = completed > 0 ? Math.round(totalDuration / completed) : 0;

  return { total, completed, connected, avgDuration };
}

/**
 * Skip a contact and advance to the next one.
 *
 * @param sessionId - The session ID
 * @param contactId - The contact to skip
 * @param reason - Reason for skipping
 * @returns The skip record
 */
export function skipContact(
  sessionId: string,
  contactId: string,
  reason: string
): SkipRecord {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (!reason) {
    throw new Error('Skip reason is required');
  }

  const record: SkipRecord = {
    sessionId,
    contactId,
    reason,
    skippedAt: new Date(),
  };

  const records = skipRecords.get(sessionId) ?? [];
  records.push(record);
  skipRecords.set(sessionId, records);

  // Advance past this contact
  session.currentIndex++;
  if (session.currentIndex >= session.contacts.length) {
    session.status = 'completed';
  }

  return record;
}

/**
 * Pause an active session.
 *
 * @param sessionId - The session ID to pause
 */
export function pauseSession(sessionId: string): DiallerSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (session.status === 'completed') {
    throw new Error('Cannot pause a completed session');
  }

  session.status = 'paused';
  return session;
}

/**
 * Resume a paused session.
 *
 * @param sessionId - The session ID to resume
 */
export function resumeSession(sessionId: string): DiallerSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (session.status !== 'paused') {
    throw new Error('Can only resume a paused session');
  }

  session.status = 'active';
  return session;
}

// ─── Test helpers ───────────────────────────────────────────

/** Clear all in-memory data (for testing) */
export function _resetStore(): void {
  sessions.clear();
  callLogs.clear();
  skipRecords.clear();
}
