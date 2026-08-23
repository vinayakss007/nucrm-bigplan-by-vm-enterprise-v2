/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Require Auth Middleware
 * Re-export from middleware.ts for backwards compatibility
 */

export {
  requireAuth,
  can,
  requirePerm,
  type AuthContext,
} from './middleware';
