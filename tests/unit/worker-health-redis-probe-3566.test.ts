/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3566 — the worker-health queue probe must look at the Redis the queue uses.
 *
 * The route used to build its BullMQ connection from `REDIS_HOST`/`REDIS_PORT`
 * (default `localhost`) while every real consumer uses `REDIS_URL`. In Docker
 * both compose files set `REDIS_URL=redis://redis:6379` and never set the host
 * variables, so the probe answered "queues inaccessible" against localhost
 * while `redis.connected` was true. These tests pin the derived URL, including
 * the legacy fallback for setups with no REDIS_URL.
 */
import { describe, it, expect } from 'vitest';
import { queueProbeRedisUrl } from '../../app/api/system/worker-health/route';

describe('#3566 the queue probe endpoint', () => {
  it('uses REDIS_URL, the endpoint every real Redis consumer uses', () => {
    expect(queueProbeRedisUrl({ REDIS_URL: 'redis://redis:6379' })).toBe('redis://redis:6379');
  });

  it('preserves credentials, TLS scheme and db from the URL', () => {
    const url = 'rediss://:secret@redis.internal:6380/4';
    expect(queueProbeRedisUrl({ REDIS_URL: url, REDIS_HOST: 'localhost', REDIS_PORT: '6379' })).toBe(url);
  });

  it('falls back to REDIS_HOST/PORT only when REDIS_URL is unset', () => {
    expect(queueProbeRedisUrl({ REDIS_HOST: 'redis', REDIS_PORT: '6380' })).toBe('redis://redis:6380');
    expect(queueProbeRedisUrl({})).toBe('redis://localhost:6379');
  });
});
