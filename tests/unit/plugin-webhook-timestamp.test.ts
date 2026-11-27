import { describe, expect, it } from 'vitest';
import { isWebhookTimestampValid } from '@/lib/plugins/webhook-handler';

const now = Date.now();
const seconds = (ms: number) => String(Math.floor(ms / 1000));

describe('plugin webhook timestamp validation', () => {
  it('accepts fresh timestamps in seconds and milliseconds', () => {
    expect(isWebhookTimestampValid(seconds(now - 30_000))).toBe(true);
    expect(isWebhookTimestampValid(String(now - 30_000))).toBe(true);
  });

  it('allows small clock skew but rejects timestamps far in the future', () => {
    expect(isWebhookTimestampValid(seconds(now + 30_000))).toBe(true);
    expect(isWebhookTimestampValid(seconds(now + 10 * 60 * 1000))).toBe(false);
  });

  it('rejects stale timestamps', () => {
    expect(isWebhookTimestampValid(seconds(now - 10 * 60 * 1000))).toBe(false);
  });

  it('keeps the documented best-effort behaviour for absent or unparseable headers', () => {
    expect(isWebhookTimestampValid(null)).toBe(true);
    expect(isWebhookTimestampValid('not-a-number')).toBe(true);
  });
});
