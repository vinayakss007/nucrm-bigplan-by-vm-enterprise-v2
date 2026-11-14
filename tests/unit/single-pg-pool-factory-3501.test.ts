/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { createPgPool } from '@/lib/db/pool';
import { pgSslConfig } from '@/lib/db/ssl-config';

describe('createPgPool factory (#3501, PR-7B)', () => {
  it('instantiates and returns a pg.Pool instance', () => {
    const pool = createPgPool({ connectionString: 'postgres://localhost/test' });
    expect(pool).toBeInstanceOf(Pool);
    void pool.end();
  });

  it('automatically applies TLS policy via pgSslConfig() by default', () => {
    const expectedSsl = pgSslConfig();
    const pool = createPgPool({ connectionString: 'postgres://localhost/test' }) as Pool & { options: { ssl: unknown } };
    expect(pool.options.ssl).toEqual(expectedSsl);
    void pool.end();
  });

  it('honors explicitly specified SSL option when provided', () => {
    const pool = createPgPool({
      connectionString: 'postgres://localhost/test',
      ssl: false,
    }) as Pool & { options: { ssl: unknown } };
    expect(pool.options.ssl).toBe(false);
    void pool.end();
  });

  it('sets standard default options for keepAlive and allowExitOnIdle', () => {
    const pool = createPgPool({
      connectionString: 'postgres://localhost/test',
    }) as Pool & { options: { keepAlive: boolean; keepAliveInitialDelayMillis: number; allowExitOnIdle: boolean } };
    expect(pool.options.keepAlive).toBe(true);
    expect(pool.options.keepAliveInitialDelayMillis).toBe(10_000);
    expect(pool.options.allowExitOnIdle).toBe(true);
    void pool.end();
  });

  it('preserves caller-supplied overrides such as max and statement_timeout', () => {
    const pool = createPgPool({
      connectionString: 'postgres://localhost/test',
      max: 5,
      statement_timeout: 15_000,
    }) as Pool & { options: { max: number; statement_timeout: number } };
    expect(pool.options.max).toBe(5);
    expect(pool.options.statement_timeout).toBe(15_000);
    void pool.end();
  });

  it('attaches an error event listener to the created pool', () => {
    const pool = createPgPool({ connectionString: 'postgres://localhost/test' });
    expect(pool.listenerCount('error')).toBeGreaterThanOrEqual(1);
    void pool.end();
  });
});
