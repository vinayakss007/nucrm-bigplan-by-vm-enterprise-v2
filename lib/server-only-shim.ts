/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Shim for `server-only` package used in Vitest tests.
// In production Next.js, this import marks modules as server-only.
// In tests, we need to stub it out since Vitest doesn't know about this package.
