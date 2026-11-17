/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3575 — any component's `unhealthy` must reach the top-level verdict.
 *
 * The endpoint emits `unhealthy` from disk (>90% full), backup, Redis and
 * alerting, but used to collapse every one of them to `degraded` + HTTP 200
 * whenever the database was healthy. These tests pin the aggregate as a pure
 * function and the removal of the database special case.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { overallHealthStatus } from '../../app/api/system/health/route';

const ROUTE = readFileSync(
  new URL('../../app/api/system/health/route.ts', import.meta.url).pathname,
  'utf8',
);

describe('#3575 the health verdict', () => {
  it('propagates a non-database unhealthy component', () => {
    expect(overallHealthStatus(['healthy', 'healthy', 'unhealthy', 'healthy'])).toBe('unhealthy');
  });

  it('propagates a database failure', () => {
    expect(overallHealthStatus(['unhealthy', 'healthy', 'healthy', 'healthy'])).toBe('unhealthy');
  });

  it('reports degraded when only warnings are present', () => {
    expect(overallHealthStatus(['healthy', 'degraded', 'healthy', 'degraded'])).toBe('degraded');
  });

  it('reports healthy when every component is healthy', () => {
    expect(overallHealthStatus(['healthy', 'healthy', 'healthy', 'healthy'])).toBe('healthy');
  });

  it('no longer special-cases the database in the route', () => {
    expect(ROUTE).toContain('health.status = overallHealthStatus(statuses);');
    expect(ROUTE).not.toContain("health.database.healthy ? 'degraded' : 'unhealthy'");
  });
});
