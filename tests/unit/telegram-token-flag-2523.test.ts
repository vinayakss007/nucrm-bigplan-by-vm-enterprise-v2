/**
 * #2523 — `GET /api/user/telegram` must not deliver the Telegram bot token to the
 * browser, and `PATCH` must not destroy the stored one now that the form cannot
 * prefill it.
 *
 * The token is what `https://api.telegram.org/bot<token>/sendMessage` is called
 * with (`lib/email/service.ts:433` sends the real alerts), so shipping it in a
 * settings response puts a working credential in client JS state on every page
 * load. The read is self-only, so this is exposure to XSS / shared machines /
 * client-side telemetry rather than a cross-user leak — and the fix is the same
 * one #2276 and #2520 applied: answer with a flag plus a `****<last4>` hint.
 *
 * The second half matters as much as the first: `PATCH` wrote
 * `telegramBotToken: body || null`, so an *omitted* token cleared the column. A
 * masking change that left that untouched would break every configured bot the
 * first time its owner toggled a notification. These fakes therefore assert both
 * directions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const TENANT_ID = '10000000-0000-4000-8000-000000000001';

// `vi.hoisted` runs before any `const` below, so the literals live in here.
const { TOKEN, harness } = vi.hoisted(() => {
  const TOKEN = '1234567:AAH-live-telegram-token-abcdefghij';
  return {
    TOKEN,
    harness: {
      storedToken: TOKEN as string | null,
      storedChatId: '987654321' as string | null,
      findFirstCalls: [] as unknown[],
      updated: undefined as Record<string, unknown> | undefined,
    },
  };
});

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      users: {
        findFirst: (options?: unknown) => {
          harness.findFirstCalls.push(options);
          const columns = (options as { columns?: Record<string, boolean> } | undefined)?.columns ?? {};
          const row: Record<string, unknown> = {};
          if (columns.telegramBotToken) row.telegramBotToken = harness.storedToken;
          if (columns.telegramChatId) row.telegramChatId = harness.storedChatId;
          if (columns.telegramEnabled) row.telegramEnabled = true;
          if (columns.telegramNotifyLogin) row.telegramNotifyLogin = true;
          if (columns.telegramNotifySignup) row.telegramNotifySignup = true;
          if (columns.telegramNotifyPasswordChange) row.telegramNotifyPasswordChange = true;
          if (columns.telegramNotify2faChange) row.telegramNotify2faChange = true;
          if (columns.telegramNotifySecurityAlerts) row.telegramNotifySecurityAlerts = true;
          return Promise.resolve(row);
        },
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        harness.updated = values;
        return { where: () => Promise.resolve([]) };
      },
    }),
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: true,
    isSuperAdmin: false,
  })),
  requireCsrf: vi.fn(() => null),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/errors', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));

function patch(body: unknown): NextRequest {
  return new Request('http://localhost/api/user/telegram', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function get(): NextRequest {
  return new Request('http://localhost/api/user/telegram', { method: 'GET' }) as unknown as NextRequest;
}

const ROUTES = () => import('@/app/api/user/telegram/route');

describe('#2523 telegram bot token stays server-side', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.storedToken = TOKEN;
    harness.storedChatId = '987654321';
    harness.findFirstCalls = [];
    harness.updated = undefined;
  });

  it('GET response never contains the token, but reports that one exists', async () => {
    const { GET } = await ROUTES();
    const res = await GET(get());
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('telegram_bot_token"');
    // Last four only — enough to recognise which bot, not enough to use it.
    expect(text).toContain('****');
    expect(text).not.toContain(TOKEN.slice(0, TOKEN.length - 4));

    const body = JSON.parse(text) as { settings: Record<string, unknown> };
    expect(body.settings.telegram_bot_token_configured).toBe(true);
    expect(body.settings.telegram_bot_token_hint).toBe(`****${TOKEN.slice(-4)}`);
  });

  it('GET keeps every notification preference the page renders', async () => {
    const { GET } = await ROUTES();
    const body = (await (await GET(get())).json()) as { settings: Record<string, unknown> };

    expect(body.settings.telegram_chat_id).toBe('987654321');
    expect(body.settings.telegram_enabled).toBe(true);
    expect(body.settings.telegram_notify_login).toBe(true);
    expect(body.settings.telegram_notify_signup).toBe(true);
    expect(body.settings.telegram_notify_password_change).toBe(true);
    expect(body.settings.telegram_notify_2fa_change).toBe(true);
    expect(body.settings.telegram_notify_security_alerts).toBe(true);
  });

  it('PATCH without a token keeps the stored one instead of clearing it', async () => {
    const { PATCH } = await ROUTES();
    const res = await PATCH(patch({ telegram_enabled: false, telegram_chat_id: '987654321' }));

    expect(res.status).toBe(200);
    expect(harness.updated).toBeDefined();
    expect(harness.updated!.telegramBotToken, 'blank must not wipe a working bot').toBe(TOKEN);
  });

  it('PATCH with an explicit null disconnects the bot', async () => {
    const { PATCH } = await ROUTES();
    await PATCH(patch({ telegram_bot_token: null, telegram_chat_id: '987654321' }));

    expect(harness.updated!.telegramBotToken).toBeNull();
  });

  it('PATCH with a typed token stores the new value', async () => {
    const { PATCH } = await ROUTES();
    const fresh = '7654321:AANew-token-value-wxyz';
    await PATCH(patch({ telegram_bot_token: fresh, telegram_chat_id: '987654321' }));

    expect(harness.updated!.telegramBotToken).toBe(fresh);
  });

  it('the test action uses the stored token, so the admin need not retype it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    const { PATCH } = await ROUTES();
    const res = await PATCH(patch({ action: 'test', telegram_chat_id: '987654321' }));

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`bot${TOKEN}/sendMessage`);
    vi.unstubAllGlobals();
  });
});
