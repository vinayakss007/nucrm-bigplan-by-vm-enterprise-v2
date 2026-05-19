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
