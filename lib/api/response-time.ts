/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * API Response Time Tracking
 *
 * Lightweight in-process latency measurement. Provides:
 * 1. `withResponseTime()` — wraps any handler to add X-Response-Time header
 * 2. `LatencyTracker` — in-memory sliding window p50/p95/p99 calculator
 *
 * Why:
 * - Grafana/Prometheus histograms are great but have 15-30s scrape delay
 * - X-Response-Time header gives instant client-side visibility
 * - In-process percentiles enable real-time alerting without external deps
 * - Debugging slow requests: client sees exactly how long the server took
 *
 * Usage:
 * ```ts
 * import { withResponseTime } from '@/lib/api/response-time';
 *
 * export async function GET(req: NextRequest) {
 *   return withResponseTime(async () => {
 *     const data = await fetchContacts();
 *     return NextResponse.json({ data });
 *   });
 * }
 * ```
 */

import { NextResponse } from 'next/server';

/**
 * Wrap an API handler to measure and report response time.
 * Adds `X-Response-Time: <ms>ms` header to the response.
 */
export async function withResponseTime(
  handler: () => Promise<NextResponse>,
  tracker?: LatencyTracker,
): Promise<NextResponse> {
  const start = performance.now();

  const response = await handler();

  const duration = performance.now() - start;
  const durationMs = Math.round(duration * 100) / 100; // 2 decimal places

  response.headers.set('X-Response-Time', `${durationMs}ms`);

  if (tracker) {
    tracker.record(durationMs);
  }

  return response;
}

/**
 * Sliding-window latency percentile tracker.
 *
 * Keeps the last N samples in a circular buffer and computes percentiles
 * on demand. Memory usage is fixed regardless of request volume.
 */
export class LatencyTracker {
  private readonly buffer: number[];
  private readonly maxSize: number;
  private index = 0;
  private count = 0;

  constructor(windowSize = 1000) {
    if (windowSize < 10 || windowSize > 100_000) {
      throw new Error('windowSize must be between 10 and 100,000');
    }
    this.maxSize = windowSize;
    this.buffer = new Array<number>(windowSize).fill(0);
  }

  /** Record a latency sample (in milliseconds). */
  record(ms: number): void {
    this.buffer[this.index % this.maxSize] = ms;
    this.index++;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  /** Get the number of samples in the window. */
  get size(): number {
    return this.count;
  }

  /** Get the Nth percentile (0–100). Returns 0 if no samples. */
  percentile(pct: number): number {
    if (this.count === 0) return 0;
    if (pct < 0 || pct > 100) throw new Error('Percentile must be between 0 and 100');

    const sorted = this.getSorted();
    const idx = Math.min(
      Math.ceil((pct / 100) * sorted.length) - 1,
      sorted.length - 1,
    );
    return sorted[Math.max(0, idx)]!;
  }

  /** Convenience: p50 (median). */
  get p50(): number {
    return this.percentile(50);
  }

  /** Convenience: p95. */
  get p95(): number {
    return this.percentile(95);
  }

  /** Convenience: p99. */
  get p99(): number {
    return this.percentile(99);
  }

  /** Mean latency. */
  get mean(): number {
    if (this.count === 0) return 0;
    const samples = this.buffer.slice(0, this.count);
    return samples.reduce((a, b) => a + b, 0) / this.count;
  }

  /** Get a summary of current latency stats. */
  summary(): LatencySummary {
    return {
      count: this.count,
      mean: Math.round(this.mean * 100) / 100,
      p50: Math.round(this.p50 * 100) / 100,
      p95: Math.round(this.p95 * 100) / 100,
      p99: Math.round(this.p99 * 100) / 100,
    };
  }

  /** Reset all samples. */
  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
  }

  private getSorted(): number[] {
    return this.buffer.slice(0, this.count).sort((a, b) => a - b);
  }
}

export interface LatencySummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Global tracker instance for the API. Routes opt-in by passing this
 * to withResponseTime().
 */
export const apiLatency = new LatencyTracker(1000);
