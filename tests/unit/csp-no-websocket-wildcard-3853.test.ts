import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const proxy = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8');
const cspLine = proxy.split('\n').find((line) => line.includes("connect-src 'self'")) ?? '';

describe('CSP connect-src has no WebSocket wildcard (#3853)', () => {
  it('allows only same-origin plus the derived Sentry origin', () => {
    expect(cspLine).toContain("connect-src 'self'${sentryOrigin}");
  });

  it('has no bare ws:/wss: source expressions', () => {
    expect(cspLine).not.toMatch(/\b(ws|wss):/);
  });

  it('derives the Sentry origin from the DSN rather than a wildcard', () => {
    expect(proxy).toContain('new URL(`https://${dsn.slice(at + 1)}`).origin');
  });

  it('matches the same-origin EventSource clients actually used', () => {
    const notifications = readFileSync(join(process.cwd(), 'lib/use-notifications.ts'), 'utf8');
    const sdk = readFileSync(join(process.cwd(), 'lib/sdk/realtime.ts'), 'utf8');
    expect(notifications).toContain("new EventSource('/api/tenant/notifications/stream')");
    expect(sdk).toContain('new EventSource(url)');
  });
});
