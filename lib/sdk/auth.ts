import type { RequestFn } from './types';

export interface AuthConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * AuthSDK - Token management for sub-services and impersonation.
 *
 * IMPORTANT: AuthSDK is NOT for replacing the NuCRMClient's own API key.
 * The API key provided in the NuCRMClient constructor is the permanent credential
 * used for all resource requests (contacts, deals, etc.). It never changes.
 *
 * AuthSDK is designed for:
 * - Generating temporary tokens for sub-services (e.g., a widget that needs
 *   limited access to the CRM)
 * - Impersonating users (admin feature for debugging/support)
 * - Initiating SSO flows that produce session tokens for end-users
 * - Managing tokens for external services that integrate with the CRM
 *
 * The `token` field maintained here is separate from the client's API key.
 * Calling `setToken()` does NOT affect the authorization header used by other
 * SDK resource calls. This is intentional - the client's API key is the
 * permanent server-to-server credential, while AuthSDK tokens are short-lived
 * credentials for specific use cases.
 */
export class AuthSDK {
  private token: string;
  private readonly request: RequestFn;

  constructor(config: AuthConfig, request: RequestFn) {
    this.token = config.apiKey;
    this.request = request;
  }

  /** Get the current managed token (not the client's API key). */
  getToken(): string {
    return this.token;
  }

  /**
   * Set a token for sub-service use. This does NOT change the client's
   * API key used for resource requests.
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Request a refreshed token from the server. Uses the client's API key
   * (the permanent credential) to authorize the refresh request.
   */
  async refreshToken(): Promise<string> {
    const result = await this.request<{ token: string }>('POST', '/auth/refresh');
    this.token = result.token;
    return result.token;
  }

  /** Generate a temporary token for impersonating a specific user (admin only). */
  async impersonate(userId: string): Promise<{ token: string }> {
    return this.request<{ token: string }>('POST', '/auth/impersonate', { userId });
  }

  /** Initiate an SSO flow and get the redirect URL for the given provider. */
  async initSSO(provider: string, redirectUrl: string): Promise<{ url: string }> {
    return this.request<{ url: string }>('POST', '/auth/sso/init', { provider, redirectUrl });
  }
}
