/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3580 — worker-health must not answer `healthy: true` while publishing
 * `queues.accessible: false`. The probe result was computed but left out of the
 * verdict, so a BullMQ outage behind a fresh heartbeat stayed green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { workerHealthVerdict } from '../../app/api/system/worker-health/route';

const ROUTE = readFileSync(
  new URL('../../app/api/system/worker-health/route.ts', import.meta.url).pathname,
  'utf8',
);

const ALL = {
  redisHealthy: true,
  heartbeatPresent: true,
  workersRunning: true,
  queuesHealthy: true,
};

describe('#3580 the worker-health verdict', () => {
  it('is healthy only when all four signals agree', () => {
    expect(workerHealthVerdict(ALL)).toBe(true);
  });

  it('is NOT healthy when the queue probe fails, even with a fresh heartbeat', () => {
    expect(workerHealthVerdict({ ...ALL, queuesHealthy: false })).toBe(false);
  });

  it.each([
    'redisHealthy',
    'heartbeatPresent',
    'workersRunning',
  ] as const)('is NOT healthy without %s', (key) => {
    expect(workerHealthVerdict({ ...ALL, [key]: false })).toBe(false);
  });

  it('the route builds its verdict from the helper, including queuesHealthy', () => {
    expect(ROUTE).toMatch(/workerHealthVerdict\(\{\s*redisHealthy, heartbeatPresent, workersRunning, queuesHealthy,/);
    expect(ROUTE).not.toContain('const healthy = redisHealthy && heartbeatPresent && workersRunning;');
  });
});
