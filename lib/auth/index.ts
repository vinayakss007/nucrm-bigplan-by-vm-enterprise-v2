/**
 * Auth Module Barrel Exports
 */

// Session management
export {
  validatePassword,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  hashToken,
  setSessionCookie,
  getSessionToken,
  clearSessionCookie,
  getCurrentUser,
} from './session';

// Authentication middleware
export {
  requireAuth,
  can,
  requirePerm,
  type AuthContext,
} from './middleware';

// API key authentication
export {
  tryApiKeyAuth,
  hasScope,
  generateApiKey,
  revokeApiKey,
  rotateApiKey,
  getApiKeyUsage,
} from './api-key';

// Auth API handlers
export {
  POST_login,
  POST_signup,
  POST_logout,
} from './api-handlers';
