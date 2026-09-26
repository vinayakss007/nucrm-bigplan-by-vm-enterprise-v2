/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env['NEXT_RUNTIME'] === "nodejs") {
    await import("./sentry.server.config");
    // #2123: pull secret files (bind-mounted /run/secrets) into process.env
    // before anything reads configuration, so compose can run the app without
    // secret values in container metadata (visible via `docker inspect`).
    const { materializeFileSecrets } = await import("./lib/secrets-file");
    materializeFileSecrets();
    const { initEnv } = await import("./lib/env");
    initEnv();

    // Register graceful shutdown handlers so SIGTERM/SIGINT drain in-flight
    // requests and close the DB pool before exit. Without this, container
    // orchestrators (K8s, ECS) kill the process mid-request during deploys.
    const { registerShutdownHandlers } = await import("./lib/db/graceful-shutdown");
    // The handler drains and then exits (process.exit lives inside the Node-only
    // graceful-shutdown module, not here — instrumentation.ts is also bundled for
    // the Edge runtime, which doesn't support process.exit).
    registerShutdownHandlers({
      drainTimeoutMs: 25_000, // K8s default terminationGracePeriodSeconds is 30
      onShutdownStart: () => {
        console.log('[instrumentation] Graceful shutdown: draining...');
      },
      onShutdownComplete: () => {
        console.log('[instrumentation] Graceful shutdown: complete. Exiting.');
      },
    });

    // Initialize metrics collection
    const { metrics } = await import("./lib/metrics");
    metrics.gauge('app_startup', 1);

    // #674 §1: pre-warm the pool so the first requests after boot don't each
    // pay TCP+TLS+auth; warmPool retries transiently with backoff when
    // Postgres starts after the app (VM reboot / deploy race). Fire-and-forget
    // — readiness still gates on /api/system/ready's own SELECT 1. Skipped in
    // the build worker (register() runs there too) and when no DB is
    // configured, so `next build` never touches Postgres.
    if (process.env.DATABASE_URL && !process.env.NEXT_PHASE?.includes('build')) {
      const { warmPool } = await import("./lib/db/warmup");
      void warmPool().catch((err) => {
        console.warn('[instrumentation] pool warm-up failed:', err instanceof Error ? err.message : err);
      });
    }

    // Auto-register Telegram bot webhook
    const botToken = process.env['TELEGRAM_BOT_TOKEN'];
    const appUrl = process.env['NEXT_PUBLIC_APP_URL'];
    if (botToken && appUrl && appUrl !== 'http://localhost:3000') {
      const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/telegram/bot`;
      fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      }).then(r => r.json()).then(d => {
        if (d.ok) console.log('[telegram] Webhook registered:', webhookUrl);
        else console.warn('[telegram] Webhook registration failed:', d.description);
      }).catch((err) => {
        console.error('[instrumentation] Telegram webhook registration failed:', err?.message || err);
      });
    }
  }

  if (process.env['NEXT_RUNTIME'] === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors
export const onRequestError = Sentry.captureRequestError;