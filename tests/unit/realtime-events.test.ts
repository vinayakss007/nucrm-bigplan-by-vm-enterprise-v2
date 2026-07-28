import { describe, it, expect } from 'vitest';
import {
  REALTIME_CHANNEL,
  REALTIME_PATH,
  RealtimeEvent,
  userRoom,
  tenantRoom,
  isRealtimeMessage,
  targetRoom,
  type RealtimeMessage,
} from '@/lib/realtime/events';

const valid: RealtimeMessage = {
  event: RealtimeEvent.NotificationNew,
  tenantId: 't1',
  userId: 'u1',
  payload: { title: 'hi' },
  ts: Date.now(),
};

describe('realtime contract', () => {
  it('pins the channel and path (nginx + server must agree)', () => {
    expect(REALTIME_CHANNEL).toBe('nucrm:realtime');
    expect(REALTIME_PATH).toBe('/socket.io');
  });

  it('rooms are always tenant-prefixed', () => {
    expect(userRoom('t1', 'u1')).toBe('t:t1:u:u1');
    expect(tenantRoom('t1')).toBe('t:t1');
    // A user room can never be confused with another tenant's user room.
    expect(userRoom('t1', 'u1')).not.toBe(userRoom('t2', 'u1'));
  });
});

describe('isRealtimeMessage', () => {
  it('accepts a well-formed envelope', () => {
    expect(isRealtimeMessage(valid)).toBe(true);
  });

  it('accepts a tenant-wide envelope with no userId', () => {
    const { userId: _omit, ...tenantWide } = valid;
    expect(isRealtimeMessage(tenantWide)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
  ])('rejects %s', (_label, input) => {
    expect(isRealtimeMessage(input)).toBe(false);
  });

  it('rejects an unknown event name', () => {
    expect(isRealtimeMessage({ ...valid, event: 'evil:event' })).toBe(false);
  });

  it('rejects a missing or empty tenantId — it would produce a colliding room', () => {
    expect(isRealtimeMessage({ ...valid, tenantId: '' })).toBe(false);
    const { tenantId: _omit, ...noTenant } = valid;
    expect(isRealtimeMessage(noTenant)).toBe(false);
  });

  it('rejects an empty userId rather than silently broadcasting tenant-wide', () => {
    expect(isRealtimeMessage({ ...valid, userId: '' })).toBe(false);
  });

  it('rejects a non-object or missing payload', () => {
    expect(isRealtimeMessage({ ...valid, payload: 'x' })).toBe(false);
    expect(isRealtimeMessage({ ...valid, payload: null })).toBe(false);
  });

  it('rejects a missing timestamp', () => {
    const { ts: _omit, ...noTs } = valid;
    expect(isRealtimeMessage(noTs)).toBe(false);
  });
});

describe('targetRoom', () => {
  it('addresses a single user when userId is present', () => {
    expect(targetRoom(valid)).toBe('t:t1:u:u1');
  });

  it('addresses the whole tenant when userId is absent', () => {
    const { userId: _omit, ...tenantWide } = valid;
    expect(targetRoom(tenantWide as RealtimeMessage)).toBe('t:t1');
  });
});
