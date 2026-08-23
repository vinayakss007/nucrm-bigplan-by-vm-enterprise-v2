/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Database Circuit Breaker
 *
 * Prevents cascading failures by stopping query attempts after N consecutive
 * failures, then gradually recovering after a cooldown period.
 *
 * States:
 * - CLOSED: normal operation, queries pass through
 * - OPEN: too many failures, queries immediately rejected
 * - HALF_OPEN: cooldown elapsed, allow one test query to check recovery
 *
 * Usage:
 * ```ts
 * import { dbCircuitBreaker } from '@/lib/db/circuit-breaker';
 *
 * async function queryWithBreaker() {
 *   if (!dbCircuitBreaker.allowRequest()) {
 *     throw new Error('Database circuit breaker is open — too many recent failures');
 *   }
 *   try {
 *     const result = await db.query(...);
 *     dbCircuitBreaker.recordSuccess();
 *     return result;
 *   } catch (err) {
 *     dbCircuitBreaker.recordFailure();
 *     throw err;
 *   }
 * }
 * ```
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Milliseconds to wait before attempting recovery (half-open) */
  cooldownMs: number;
  /** Number of successes in half-open needed to close the circuit */
  successThreshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000, // 30 seconds
  successThreshold: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if a request should be allowed through */
  allowRequest(): boolean {
    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN': {
        // Check if cooldown has elapsed
        const elapsed = Date.now() - this.lastFailureTime;
        if (elapsed >= this.config.cooldownMs) {
          this.state = 'HALF_OPEN';
          this.successCount = 0;
          return true; // allow test request
        }
        return false; // still in cooldown
      }

      case 'HALF_OPEN':
        return true; // allow test requests in half-open
    }
  }

  /** Record a successful operation */
  recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
      }
    }
  }

  /** Record a failed operation */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Failed during recovery — back to open
      this.state = 'OPEN';
      return;
    }

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /** Get current state for monitoring */
  getState(): { state: CircuitState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** Reset the circuit breaker (for testing or manual recovery) */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}

/** Singleton instance for database operations */
export const dbCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  cooldownMs: 30_000,
  successThreshold: 2,
});
