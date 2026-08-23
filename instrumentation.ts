/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env['NEXT_RUNTIME'] === "nodejs") {
    await import("./sentry.server.config");
    const { initEnv } = await import("./lib/env");
    initEnv();

    // Register graceful shutdown handlers so SIGTERM/SIGINT drain in-flight
    // requests and close the DB pool before exit. Without this, container
    // orchestrators (K8s, ECS) kill the process mid-request during deploys.
    const { registerShutdownHandlers } = await import("./lib/db/graceful-shutdown");
    registerShutdownHandlers({
      drainTimeoutMs: 25_000, // K8s default terminationGracePeriodSeconds is 30
      onShutdownStart: () => {
        console.log('[instrumentation] Graceful shutdown: draining...');
      },
      onShutdownComplete: () => {
        console.log('[instrumentation] Graceful shutdown: complete. Exiting.');
        process.exit(0);
      },
    });

    // Initialize metrics collection
    const { metrics } = await import("./lib/metrics");
    metrics.gauge('app_startup', 1);

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