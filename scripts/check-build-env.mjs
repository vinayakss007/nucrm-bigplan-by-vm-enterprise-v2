/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

import { lstatSync } from 'node:fs';

/**
 * Build-time guard: refuse to run `next build` with NODE_ENV=development.
 *
 * Why: building in development mode makes Next use the dev React runtime during
 * static prerendering, which crashes the export with
 *   "TypeError: Cannot read properties of null (reading 'useContext')"
 * on pages such as /_global-error and /auth/forgot-password. The failure is
 * silent about its real cause and only appears at the "Generating static pages"
 * step, wasting a full compile before it aborts.
 *
 * A production build must run with NODE_ENV unset (Next defaults it to
 * "production") or NODE_ENV=production. CI builds with NODE_ENV=test, which is
 * also fine. Only "development" is rejected here.
 *
 * This runs as the `prebuild` npm script, so it fires automatically before
 * every `npm run build`.
 */
const nodeEnv = process.env.NODE_ENV;

if (nodeEnv === 'development') {
  console.error(
    '\n\u001b[31m✖ Refusing to build with NODE_ENV=development.\u001b[0m\n' +
      '\n' +
      '  `next build` in development mode breaks static prerendering with\n' +
      "  \"Cannot read properties of null (reading 'useContext')\" on pages\n" +
      '  like /_global-error and /auth/forgot-password.\n' +
      '\n' +
      '  Fix: unset NODE_ENV (Next defaults to production) or set\n' +
      '  NODE_ENV=production before building. Check for a leaked\n' +
      '  NODE_ENV=development in your .env / .env.local on the build host.\n',
  );
  process.exit(1);
}

/**
 * Second refusal: a symlinked `node_modules`.
 *
 * Why: Turbopack cannot resolve one and panics with
 *   "Symlink node_modules could not be resolved: the symlink target leaves the
 *    filesystem root or its parent directory could not be resolved"
 * — after compiling, so the run is lost. It is not a repo bug: it is what a
 * worktree prepared with `ln -s …/node_modules` looks like to the bundler
 * (07 § Local worktrees). The cheap fix is a hardlink copy, which shares inodes.
 */
let nodeModulesIsSymlink = false;
try {
  nodeModulesIsSymlink = lstatSync('node_modules').isSymbolicLink();
} catch (err) {
  // No node_modules at all is `npm install`'s problem, not this guard's.
  if (err.code !== 'ENOENT') throw err;
}

if (nodeModulesIsSymlink) {
  console.error(
    '\n\u001b[31m✖ Refusing to build: node_modules is a symlink.\u001b[0m\n' +
      '\n' +
      '  Turbopack cannot resolve a symlinked node_modules; it panics partway\n' +
      '  through the compile with "Symlink node_modules could not be resolved",\n' +
      '  after the build work is already spent.\n' +
      '\n' +
      '  Fix: give this tree a real node_modules. A hardlink copy shares inodes\n' +
      '  and costs near-zero disk:\n' +
      '      cp -al <source-checkout>/node_modules ./node_modules\n' +
      '  (docs/BASECRM/07-OPS-NOTES.md § Local worktrees)\n',
  );
  process.exit(1);
}

console.log(
  `[check-build-env] OK — building with NODE_ENV=${nodeEnv ?? '(unset → production)'}`,
);

