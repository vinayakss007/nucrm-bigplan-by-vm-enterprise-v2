import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env['NEXT_RUNTIME'] === "nodejs") {
    await import("./sentry.server.config");
    const { initEnv } = await import("./lib/env");
    initEnv();
  }

  if (process.env['NEXT_RUNTIME'] === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors
export const onRequestError = Sentry.captureRequestError;