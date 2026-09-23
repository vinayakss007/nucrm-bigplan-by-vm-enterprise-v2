#!/usr/bin/env tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Companion probe for scripts/preprod-api-e2e.ts (check A2).
 *
 * POST /api/setup/create-admin guards itself with the server-side SETUP_KEY only
 * when NODE_ENV === 'production'. A Next *dev* bundle inlines that constant, so
 * the branch cannot be reached by merely mutating process.env in the harness
 * process. This probe therefore runs in its own `tsx` child process started with
 * a real NODE_ENV=production in the environment.
 *
 * The body it sends is *deliberately invalid* (missing workspace_name, short
 * password). That makes the probe write-proof:
 *   403  -> the key gate ran and rejected the request  (gate works, fails closed)
 *   400  -> the gate was skipped and schema validation stopped it (dev inlining)
 *   2xx  -> impossible with this body; would mean a real bootstrap, so it is
 *           reported as a hard failure instead of silently creating rows.
 */
import { NextRequest } from 'next/server';
import { POST as createAdmin } from '../app/api/setup/create-admin/route';

async function main(): Promise<void> {
  const req = new NextRequest('http://localhost:3000/api/setup/create-admin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-setup-key': 'definitely-not-the-real-setup-key',
      'x-forwarded-for': '198.51.100.2',
    },
    body: JSON.stringify({ full_name: 'Gate Probe', email: 'gate.probe@preprod.nucrm.test', password: 'x' }),
  });
  const res = await (createAdmin as unknown as (r: NextRequest) => Promise<Response>)(req);
  const text = await res.text();
  console.log(`GATE_NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`GATE_RESULT ${res.status}`);
  console.log(`GATE_BODY=${text.slice(0, 160)}`);
  process.exit(0);
}

void main().catch((err) => {
  console.log('GATE_RESULT -1');
  console.log('GATE_ERR=' + (err instanceof Error ? err.message : String(err)).slice(0, 200));
  process.exit(1);
});
