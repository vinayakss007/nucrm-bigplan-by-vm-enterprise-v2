/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// GDPR collection ceiling for Sentry. Shared by sentry.client.config.ts,
// sentry.server.config.ts and sentry.edge.config.ts.

/**
 * v11 retired `sendDefaultPii` and replaced it with `dataCollection` — whose
 * defaults are all ON. Measured against the installed @sentry/core 11.1.0:
 * `resolveDataCollectionOptions({})` returns
 * `userInfo: true · cookies: true · httpHeaders: {request: true, response: true}
 * · httpBodies: incoming+outgoing request AND response · urlQueryParams: true
 * · graphQL: {document: true, variables: true} · genAI: {inputs: true, outputs: true}
 * · databaseQueryData: true · queues: true · stackFrameVariables: true
 * · frameContextLines: 5`.
 *
 * So omitting the option is the *maximum*-PII setting. The old comment in these
 * files ("anything other than an explicit opt-in is off") described v10 and is
 * wrong for v11; the whole object is spelled out instead of relying on a
 * default, and the accompanying test asserts this list covers every field the
 * installed resolver knows about, so a future Sentry that adds a collector
 * fails the build rather than quietly shipping customer data.
 *
 * `beforeSend: scrubPii` remains as the second layer for what the SDK puts into
 * an event regardless of these switches (our own breadcrumbs, error messages,
 * stack paths).
 */
export const DATA_COLLECTION = {
  // Never populate `event.user` from instrumentation (session, JWT, cookies).
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  // Bound parameters and returned rows of DB queries — customer records.
  databaseQueryData: false,
  queues: false,
  // Local variable values in stack frames.
  stackFrameVariables: false,
  // Source lines around each frame; our repository is the readable copy.
  frameContextLines: 0,
};
