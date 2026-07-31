/**
 * Tests for lib/api/response-time.ts
 */
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { withResponseTime, LatencyTracker } from '@/lib/api/response-time';

describe('withResponseTime', () => {
  it('adds X-Response-Time header', async () => {
    const response = await withResponseTime(async () => {
      return NextResponse.json({ ok: true });
    });

    const header = response.headers.get('X-Response-Time');
    expect(header).toMatch(/^\d+(\.\d+)?ms$/);
  });

  it('preserves response body and status', async () => {
    const response = await withResponseTime(async () => {
      return NextResponse.json({ data: [1, 2, 3] }, { status: 201 });
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toEqual([1, 2, 3]);
  });

  it('measures time of slow handler', async () => {
    const response = await withResponseTime(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return NextResponse.json({ ok: true });
    });

    const header = response.headers.get('X-Response-Time')!;
    const ms = parseFloat(header.replace('ms', ''));
    expect(ms).toBeGreaterThanOrEqual(45); // Allow small timing variance
  });

  it('records to tracker when provided', async () => {
    const tracker = new LatencyTracker(100);

    await withResponseTime(async () => {
      return NextResponse.json({ ok: true });
    }, tracker);

    expect(tracker.size).toBe(1);
  });
});

describe('LatencyTracker', () => {
  it('starts empty', () => {
    const tracker = new LatencyTracker();
    expect(tracker.size).toBe(0);
    expect(tracker.p50).toBe(0);
    expect(tracker.p95).toBe(0);
    expect(tracker.p99).toBe(0);
    expect(tracker.mean).toBe(0);
  });

  it('records samples and computes percentiles', () => {
    const tracker = new LatencyTracker(100);

    // Add values 1 through 100
    for (let i = 1; i <= 100; i++) {
      tracker.record(i);
    }

    expect(tracker.size).toBe(100);
    expect(tracker.p50).toBe(50);
    expect(tracker.p95).toBe(95);
    expect(tracker.p99).toBe(99);
    expect(tracker.mean).toBeCloseTo(50.5, 0);
  });

  it('sliding window evicts old samples', () => {
    const tracker = new LatencyTracker(10);

    // Fill with 10 values: all 100ms
    for (let i = 0; i < 10; i++) tracker.record(100);

    expect(tracker.p50).toBe(100);

    // Now add 10 values of 200ms (should evict the old ones)
    for (let i = 0; i < 10; i++) tracker.record(200);

    expect(tracker.p50).toBe(200);
    expect(tracker.size).toBe(10); // Capped at window size
  });

  it('computes mean correctly', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(10);
    tracker.record(20);
    tracker.record(30);

    expect(tracker.mean).toBe(20);
  });

  it('percentile(0) returns minimum', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(5);
    tracker.record(10);
    tracker.record(50);

    // p0 should be the smallest value
    expect(tracker.percentile(0)).toBe(5);
  });

  it('percentile(100) returns maximum', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(5);
    tracker.record(10);
    tracker.record(50);

    expect(tracker.percentile(100)).toBe(50);
  });

  it('throws for out-of-range percentiles', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(1);

    expect(() => tracker.percentile(-1)).toThrow();
    expect(() => tracker.percentile(101)).toThrow();
  });

  it('summary returns formatted stats', () => {
    const tracker = new LatencyTracker(100);
    for (let i = 1; i <= 50; i++) tracker.record(i);

    const summary = tracker.summary();
    expect(summary.count).toBe(50);
    expect(summary.mean).toBeGreaterThan(0);
    expect(summary.p50).toBeGreaterThan(0);
    expect(summary.p95).toBeGreaterThan(0);
    expect(summary.p99).toBeGreaterThan(0);
  });

  it('reset clears all samples', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(10);
    tracker.record(20);
    expect(tracker.size).toBe(2);

    tracker.reset();
    expect(tracker.size).toBe(0);
    expect(tracker.mean).toBe(0);
  });

  it('validates windowSize bounds', () => {
    expect(() => new LatencyTracker(5)).toThrow();
    expect(() => new LatencyTracker(200_000)).toThrow();
  });

  it('handles single sample', () => {
    const tracker = new LatencyTracker(100);
    tracker.record(42);

    expect(tracker.p50).toBe(42);
    expect(tracker.p95).toBe(42);
    expect(tracker.p99).toBe(42);
    expect(tracker.mean).toBe(42);
  });
});
