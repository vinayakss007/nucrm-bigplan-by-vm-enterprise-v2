/**
 * NuCRM Plugin Execution Engine
 *
 * Core engine that:
 * 1. Takes a plugin record + action name + params
 * 2. Resolves auth (builds Authorization header or query param based on authType)
 * 3. Interpolates variables in action path/body templates using {{variable}} syntax
 * 4. Makes the HTTP call with timeout (10s default)
 * 5. Logs execution to plugin_execution_logs table
 * 6. Returns structured result
 *
 * Supports all auth types: bearer, basic, api_key_header, api_key_query,
 * oauth2_client_credentials, and none.
 */

import { db } from '@/drizzle/db';
import { pluginExecutionLogs, customPlugins } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import type {
  PluginDefinition,
  PluginAction,
  PluginAuthConfig,
  PluginExecutionResult,
  PluginTestResult,
} from './types';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Interpolate {{variable}} placeholders in a string using the provided params.
 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Build authorization headers/query params based on auth type.
 */
async function resolveAuth(
  authConfig: PluginAuthConfig,
  url: URL
): Promise<{ headers: Record<string, string>; url: URL }> {
  const headers: Record<string, string> = {};

  switch (authConfig.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${authConfig.token}`;
      break;

    case 'basic': {
      const encoded = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      break;
    }

    case 'api_key_header':
      headers[authConfig.headerName] = authConfig.apiKey;
      break;

    case 'api_key_query':
      url.searchParams.set(authConfig.paramName, authConfig.apiKey);
      break;

    case 'oauth2_client_credentials': {
      const tokenResponse = await fetchOAuth2Token(authConfig);
      if (tokenResponse) {
        headers['Authorization'] = `Bearer ${tokenResponse}`;
      }
      break;
    }

    case 'none':
      break;
  }

  return { headers, url };
}

/**
 * Fetch an OAuth2 access token using client credentials grant.
 */
async function fetchOAuth2Token(
  config: Extract<PluginAuthConfig, { type: 'oauth2_client_credentials' }>
): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    if (config.scope) {
      body.set('scope', config.scope);
    }

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return (data['access_token'] as string) || null;
  } catch (e) {
    console.error('[Plugin] Token exchange failed:', e);
    return null;
  }
}

/**
 * Execute a plugin action.
 */
export async function executePluginAction(
  plugin: PluginDefinition,
  actionName: string,
  params: Record<string, unknown>
): Promise<PluginExecutionResult> {
  const action = plugin.actions.find((a) => a.id === actionName || a.name === actionName);
  if (!action) {
    return { success: false, error: `Action "${actionName}" not found on plugin "${plugin.name}"` };
  }

  const startTime = Date.now();
  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let requestUrl = '';
  let requestHeaders: Record<string, string> = {};
  let requestBody: unknown = undefined;

  try {
    // Build the full URL with interpolated path
    const interpolatedPath = interpolate(action.path, params);
    const fullUrl = new URL(interpolatedPath, plugin.baseUrl);
    requestUrl = fullUrl.toString();

    // Resolve auth
    const authResult = await resolveAuth(plugin.authConfig, fullUrl);
    requestHeaders = { ...authResult.headers };
    const resolvedUrl = authResult.url;

    // Add custom headers
    for (const [key, value] of Object.entries(plugin.customHeaders)) {
      requestHeaders[key] = value;
    }

    // Build request body from template if not GET/DELETE
    if (action.method !== 'GET' && action.method !== 'DELETE' && action.bodyTemplate) {
      const interpolatedBody = interpolate(action.bodyTemplate, params);
      try {
        requestBody = JSON.parse(interpolatedBody);
      } catch (e) {
        console.warn('[Plugin] Body template is not valid JSON, using as raw string:', e);
        requestBody = interpolatedBody;
      }
      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    // Execute the HTTP call
    const fetchOptions: RequestInit = {
      method: action.method,
      headers: requestHeaders,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };

    if (requestBody !== undefined) {
      fetchOptions.body = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
    }

    const response = await fetch(resolvedUrl.toString(), fetchOptions);
    responseStatus = response.status;
    responseBody = await response.text();

    const durationMs = Date.now() - startTime;
    const success = response.ok;

    // Log execution
    await logExecution(plugin, action, {
      requestUrl: resolvedUrl.toString(),
      requestHeaders,
      requestBody,
      responseStatus,
      responseBody,
      durationMs,
      success,
      errorMessage: success ? undefined : `HTTP ${responseStatus}`,
    });

    // Update plugin lastUsedAt
    await db.update(customPlugins)
      .set({ lastUsedAt: new Date(), lastError: success ? null : `HTTP ${responseStatus}` })
      .where(eq(customPlugins.id, plugin.id));

    // Parse response
    let data: unknown = responseBody;
    try {
      data = JSON.parse(responseBody);
    } catch (e) {
      console.warn('[Plugin] Response is not valid JSON, leaving as raw text:', e);
    }

    // Apply response mapping if configured
    if (success && action.responseMapping && typeof data === 'object' && data !== null) {
      const mapped: Record<string, unknown> = {};
      for (const [outputKey, sourcePath] of Object.entries(action.responseMapping)) {
        mapped[outputKey] = getNestedValue(data as Record<string, unknown>, sourcePath);
      }
      data = mapped;
    }

    return { success, data, responseStatus, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logExecution(plugin, action, {
      requestUrl,
      requestHeaders,
      requestBody,
      responseStatus: undefined,
      responseBody: undefined,
      durationMs,
      success: false,
      errorMessage,
    });

    // Update plugin error state (keep status active - transient failures should not disable)
    await db.update(customPlugins)
      .set({ lastError: errorMessage })
      .where(eq(customPlugins.id, plugin.id));

    return { success: false, error: errorMessage, durationMs };
  }
}

/**
 * Test plugin connectivity by making a simple request to the base URL.
 */
export async function testPluginConnection(plugin: PluginDefinition): Promise<PluginTestResult> {
  const startTime = Date.now();

  try {
    const url = new URL(plugin.baseUrl);
    const authResult = await resolveAuth(plugin.authConfig, url);

    const headers: Record<string, string> = { ...authResult.headers };
    for (const [key, value] of Object.entries(plugin.customHeaders)) {
      headers[key] = value;
    }

    const response = await fetch(authResult.url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok || response.status === 401 || response.status === 403) {
      // Even 401/403 means the server is reachable
      if (response.ok) {
        return { success: true, responseStatus: response.status, latencyMs, message: 'Connection successful' };
      }
      return { success: false, responseStatus: response.status, latencyMs, message: `Server reachable but returned ${response.status} - check authentication config` };
    }

    return { success: false, responseStatus: response.status, latencyMs, message: `Server returned ${response.status}` };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { success: false, latencyMs, message };
  }
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Log a plugin execution to the database.
 */
async function logExecution(
  plugin: PluginDefinition,
  action: PluginAction,
  details: {
    requestUrl: string;
    requestHeaders: Record<string, string>;
    requestBody: unknown;
    responseStatus: number | undefined;
    responseBody: string | undefined;
    durationMs: number;
    success: boolean;
    errorMessage: string | undefined;
  }
): Promise<void> {
  try {
    // Sanitize headers for logging (remove auth tokens)
    const sanitizedHeaders = { ...details.requestHeaders };
    if (sanitizedHeaders['Authorization']) {
      sanitizedHeaders['Authorization'] = '[REDACTED]';
    }

    await db.insert(pluginExecutionLogs).values({
      tenantId: plugin.tenantId,
      pluginId: plugin.id,
      actionName: action.name,
      method: action.method,
      url: details.requestUrl,
      requestHeaders: sanitizedHeaders,
      requestBody: details.requestBody as Record<string, unknown> | null,
      responseStatus: details.responseStatus ?? null,
      responseBody: details.responseBody?.slice(0, 10_000) ?? null, // Limit response body size
      durationMs: details.durationMs,
      success: details.success,
      errorMessage: details.errorMessage ?? null,
    });
  } catch (e) {
    console.error('[PluginEngine] Failed to log execution:', e);
  }
}
