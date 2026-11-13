#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * guard-census.mjs (#3412, PR-7D)
 *
 * Resolves every `guard:*` alias defined in `package.json` to its script file,
 * then inspects `.github/workflows/*.yml` to verify which guards are wired
 * (either directly via `npm run guard:...` or via a bare script invocation
 * like `node scripts/...` or `npx tsx scripts/...`).
 *
 * Makes the guard estate measurement reproducible and testable without
 * relying on brittle manual regex one-liners.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

/**
 * Computes guard census data for a given workspace root.
 *
 * @param {string} root
 * @returns {{
 *   total: number,
 *   wiredCount: number,
 *   unwiredCount: number,
 *   unwired: string[],
 *   wired: string[],
 *   perWorkflow: Record<string, string[]>,
 *   bareInvocations: Array<{ alias: string, file: string, script: string }>
 * }}
 */
export function computeCensus(root = ROOT) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const guards = Object.entries(pkg.scripts || {}).filter(([k]) => k.startsWith('guard:'));

  const workflowDir = join(root, '.github', 'workflows');
  const workflowFiles = existsSync(workflowDir)
    ? readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    : [];

  const workflows = workflowFiles.map((f) => {
    const raw = readFileSync(join(workflowDir, f), 'utf8');
    const noComments = raw
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    return { file: f, content: noComments };
  });

  const wired = new Set();
  const perWorkflow = {};
  for (const w of workflows) {
    perWorkflow[w.file] = [];
  }

  const bareInvocations = [];

  for (const [alias, cmd] of guards) {
    const scriptMatches = [...cmd.matchAll(/scripts\/[\w./-]+\.(mjs|cjs|ts|mts|js)/g)].map((m) => m[0]);
    // The target script is the main executed script (excluding load-env.mjs or helper flags)
    const targetScript = scriptMatches.filter((s) => !s.includes('load-env.mjs')).pop() || scriptMatches[0];

    for (const w of workflows) {
      const hasAlias = w.content.includes(`npm run ${alias}`);
      const hasScript = targetScript && w.content.includes(targetScript);

      if (hasAlias || hasScript) {
        wired.add(alias);
        perWorkflow[w.file].push(alias);
        if (!hasAlias && hasScript) {
          bareInvocations.push({ alias, file: w.file, script: targetScript });
        }
      }
    }
  }

  const unwired = guards.map(([k]) => k).filter((k) => !wired.has(k));
  const wiredList = [...wired].sort();

  return {
    total: guards.length,
    wiredCount: wired.size,
    unwiredCount: unwired.length,
    unwired,
    wired: wiredList,
    perWorkflow,
    bareInvocations,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const census = computeCensus();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(census, null, 2));
  } else {
    console.log(`[guard-census] Total guard aliases in package.json: ${census.total}`);
    console.log(`[guard-census] Wired in workflows: ${census.wiredCount}/${census.total}`);
    console.log(`[guard-census] Unwired (${census.unwiredCount}): ${census.unwired.join(', ') || 'none'}`);
    console.log('[guard-census] Breakdown per workflow:');
    for (const [file, list] of Object.entries(census.perWorkflow)) {
      if (list.length > 0) {
        console.log(`  - ${file}: ${list.length} guard(s)`);
      }
    }
    if (census.bareInvocations.length > 0) {
      console.log('[guard-census] Bare script invocations (run by script path, not npm alias):');
      for (const item of census.bareInvocations) {
        console.log(`  - ${item.alias} in ${item.file} (${item.script})`);
      }
    }
  }
}
