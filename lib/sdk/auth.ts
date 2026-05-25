import type { RequestFn } from './types';

export interface AuthConfig {
  baseUrl: string;
  apiKey: string;
}

export class AuthSDK {
  private token: string;
  private readonly request: RequestFn;

  constructor(config: AuthConfig, request: RequestFn) {
    this.token = config.apiKey;
    this.request = request;
  }

  getToken(): string {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async refreshToken(): Promise<string> {
    const result = await this.request<{ token: string }>('POST', '/auth/refresh');
    this.token = result.token;
    return result.token;
  }

  async impersonate(userId: string): Promise<{ token: string }> {
    return this.request<{ token: string }>('POST', '/auth/impersonate', { userId });
  }

  async initSSO(provider: string, redirectUrl: string): Promise<{ url: string }> {
    return this.request<{ url: string }>('POST', '/auth/sso/init', { provider, redirectUrl });
  }
}
