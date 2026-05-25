/**
 * Module gate — thin re-export shim so route handlers can do
 *
 *   import { requireModule, requireFeature } from '@/lib/modules/gate';
 *
 * The actual implementation lives in `lib/auth/middleware.ts` (kept there to
 * avoid a circular import with the registry). This file exists so the path
 * matches the architecture docs and future moves don't churn imports.
 */
export { requireModule, requireFeature } from '@/lib/auth/middleware';
export type { AuthContext } from '@/lib/auth/middleware';
