/**
 * NuCRM Plugin System Types
 *
 * The plugin system is the proper way to connect custom APIs.
 * Unlike the built-in integrations (lib/integrations/) which handle curated
 * first-party providers, plugins allow users to define their own HTTP endpoints
 * with full auth and action configuration.
 */

export type PluginAuthType =
  | 'bearer'
  | 'basic'
  | 'api_key_header'
  | 'api_key_query'
  | 'oauth2_client_credentials'
  | 'none';

export type PluginStatus = 'active' | 'disabled' | 'error';

export interface PluginAction {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // supports {{variable}} interpolation
  bodyTemplate?: string; // JSON template with {{variable}} placeholders
  responseMapping?: Record<string, string>; // maps response fields to output keys
}

export type PluginAuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'api_key_header'; headerName: string; apiKey: string }
  | { type: 'api_key_query'; paramName: string; apiKey: string }
  | { type: 'oauth2_client_credentials'; clientId: string; clientSecret: string; tokenUrl: string; scope?: string }
  | { type: 'none' };

export interface PluginDefinition {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  baseUrl: string;
  authType: PluginAuthType;
  authConfig: PluginAuthConfig;
  customHeaders: Record<string, string>;
  actions: PluginAction[];
  webhookSecret?: string | null;
  status: PluginStatus;
  lastUsedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

export interface PluginExecutionResult {
  success: boolean;
  data?: unknown;
  responseStatus?: number;
  durationMs?: number;
  error?: string;
}

export interface PluginTestResult {
  success: boolean;
  responseStatus?: number;
  latencyMs?: number;
  message: string;
}

export interface WebhookPayload {
  pluginId: string;
  headers: Record<string, string>;
  body: unknown;
  receivedAt: string;
  verified: boolean;
}

export interface PluginTemplate {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: PluginAuthType;
  actions: PluginAction[];
}
