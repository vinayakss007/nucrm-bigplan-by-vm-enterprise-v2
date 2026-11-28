import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'lib/webhooks.ts'), 'utf8');
const fireStart = src.indexOf('export async function fireWebhooks');
const fireEnd = src.indexOf('/** Maximum number of concurrent webhook retry requests */');
const fire = src.slice(fireStart, fireEnd);

describe('webhook fan-out batching (#4060)', () => {
  it('inserts the whole fan-out in one statement', () => {
    expect(fire).toContain('.values(targets.map((target) => ({');
    expect(fire).not.toContain('for (const hook of hooks)');
  });

  it('delivers in bounded parallel batches', () => {
    expect(fire).toContain('Promise.allSettled(batch.map(async (delivery, offset) => {');
    expect(fire).toContain('i += MAX_CONCURRENCY');
  });

  it('preserves SSRF blocking, retry status and event subscription filtering', () => {
    expect(fire).toContain('SsrfBlockedError');
    expect(fire).toContain("status: 'dead_letter'");
    expect(fire).toContain('getRetryDelay(nextAttempt)');
    expect(fire).toContain('subscribedEvents.includes(event)');
    expect(fire).toContain('webhookSignature(config.secret, payload)');
  });
});
