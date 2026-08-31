/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

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

console.log(
  `[check-build-env] OK — building with NODE_ENV=${nodeEnv ?? '(unset → production)'}`,
);
