import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, withDbCircuitBreaker, dbCircuitBreaker, CircuitOpenError } from '@/lib/db/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, successThreshold: 2 });
  });

  it('starts in CLOSED state allowing all requests', () => {
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('stays CLOSED after fewer failures than threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState().state).toBe('OPEN');
    expect(breaker.allowRequest()).toBe(false);
  });

  it('resets failure count on success', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    expect(breaker.getState().failureCount).toBe(0);
    // Now needs 3 more failures to open
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState().state).toBe('CLOSED');
  });

  it('transitions to HALF_OPEN after cooldown', async () => {
    // Use a very short cooldown for testing
    const fastBreaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 50, successThreshold: 1 });
    fastBreaker.recordFailure();
    fastBreaker.recordFailure();
    expect(fastBreaker.getState().state).toBe('OPEN');
    expect(fastBreaker.allowRequest()).toBe(false);

    // Wait for cooldown
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(fastBreaker.allowRequest()).toBe(true); // transitions to HALF_OPEN
    expect(fastBreaker.getState().state).toBe('HALF_OPEN');
  });

  it('closes from HALF_OPEN after success threshold', async () => {
    const fastBreaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10, successThreshold: 2 });
    fastBreaker.recordFailure();
    fastBreaker.recordFailure();

    await new Promise(resolve => setTimeout(resolve, 15));
    fastBreaker.allowRequest(); // trigger HALF_OPEN

    fastBreaker.recordSuccess();
    expect(fastBreaker.getState().state).toBe('HALF_OPEN');
    fastBreaker.recordSuccess();
    expect(fastBreaker.getState().state).toBe('CLOSED');
  });

  it('goes back to OPEN from HALF_OPEN on failure', async () => {
    const fastBreaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10, successThreshold: 2 });
    fastBreaker.recordFailure();
    fastBreaker.recordFailure();

    await new Promise(resolve => setTimeout(resolve, 15));
    fastBreaker.allowRequest(); // trigger HALF_OPEN

    fastBreaker.recordFailure();
    expect(fastBreaker.getState().state).toBe('OPEN');
  });

  it('reset() returns to initial CLOSED state', () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState().state).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState().state).toBe('CLOSED');
    expect(breaker.getState().failureCount).toBe(0);
    expect(breaker.allowRequest()).toBe(true);
  });
});

// #1224: the shared helper that actually wires the breaker into DB calls.
describe('withDbCircuitBreaker', () => {
  beforeEach(() => {
    dbCircuitBreaker.reset();
  });

  it('returns the result and records success when the op succeeds', async () => {
    const result = await withDbCircuitBreaker(async () => 'ok');
    expect(result).toBe('ok');
    expect(dbCircuitBreaker.getState().state).toBe('CLOSED');
  });

  it('propagates the error and records a failure', async () => {
    await expect(withDbCircuitBreaker(async () => { throw new Error('db down'); }))
      .rejects.toThrow('db down');
    expect(dbCircuitBreaker.getState().failureCount).toBe(1);
  });

  it('short-circuits with CircuitOpenError once the breaker is open', async () => {
    // dbCircuitBreaker opens after 5 consecutive failures (its config).
    for (let i = 0; i < 5; i++) {
      await expect(withDbCircuitBreaker(async () => { throw new Error('fail'); })).rejects.toThrow();
    }
    expect(dbCircuitBreaker.getState().state).toBe('OPEN');

    // The next call is rejected immediately without invoking the operation.
    let invoked = false;
    await expect(
      withDbCircuitBreaker(async () => { invoked = true; return 'should not run'; })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(invoked).toBe(false);
  });
});
