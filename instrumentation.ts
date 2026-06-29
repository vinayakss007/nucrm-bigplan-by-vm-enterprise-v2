import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env['NEXT_RUNTIME'] === "nodejs") {
    await import("./sentry.server.config");
    const { initEnv } = await import("./lib/env");
    initEnv();

    // DB schema is auto-synced via `npm run dev` script — no startup sync needed
  }

  if (process.env['NEXT_RUNTIME'] === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors
export const onRequestError = Sentry.captureRequestError;