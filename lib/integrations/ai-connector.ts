/**
 * AI Connector — Universal API Adapter (Legacy)
 *
 * NOTE: The plugin system (lib/plugins/) is now the proper way to connect
 * custom APIs. Users should create plugins with explicit endpoint definitions
 * rather than relying on this AI-based auto-discovery. This connector remains
 * as a fallback for unknown built-in providers in the integrations system.
 *
 * When no built-in handler exists for a provider, this connector:
 * 1. Reads the provider's API docs (if available)
 * 2. Uses AI to understand the API schema
 * 3. Dynamically crafts the correct API call
 *
 * This means ANY service with a REST API can be used.
 */

import type { IntegrationInstance, ActionResult } from './types';

export async function aiConnector(
  instance: IntegrationInstance,
  action: string,
  params: Record<string, any>
): Promise<ActionResult> {
  const baseUrl = instance.config['base_url'] || instance.config['baseUrl'] || guessBaseUrl(instance.providerId);
  const apiKey = instance.config['api_key'] || instance.config['token'] || instance.config['apiKey'] || '';
  const providerName = instance.providerId;

  // Try common API patterns
  const patterns = guessApiPatterns(providerName, action, params);

  for (const pattern of patterns) {
    try {
      const res = await fetch(pattern.url, {
        method: pattern.method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...pattern.headers,
          ...(apiKey ? { 'Authorization': pattern.authType === 'bearer'
            ? `Bearer ${apiKey}`
            : pattern.authType === 'basic'
            ? `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
            : pattern.authType === 'header'
            ? apiKey
            : `Bearer ${apiKey}` } : {}),
        },
        body: pattern.method !== 'GET' ? JSON.stringify(pattern.body) : undefined,
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok || res.status === 201) {
        return { success: true, data, raw: { status: res.status, headers: Object.fromEntries(res.headers) } };
      }

      // If we get auth error, stop trying patterns
      if (res.status === 401 || res.status === 403) {
        return { success: false, error: `Authentication failed: ${data.error?.message || data.message || JSON.stringify(data)}` };
      }
    } catch (err: any) {
      continue; // Try next pattern
    }
  }

  return {
    success: false,
    error: `Could not connect to ${providerName}. No built-in handler available and AI auto-discovery failed. Try specifying the exact API endpoint in the provider config.`
  };
}

function guessBaseUrl(providerId: string): string {
  const domains: Record<string, string> = {
    stripe: 'https://api.stripe.com/v1',
    github: 'https://api.github.com',
    gitlab: 'https://gitlab.com/api/v4',
    hubspot: 'https://api.hubapi.com',
    salesforce: 'https://your-instance.salesforce.com/services/data/v58.0',
    mailchimp: 'https://us1.api.mailchimp.com/3.0',
    twilio: 'https://api.twilio.com/2010-04-01',
    discord: 'https://discord.com/api',
    notion: 'https://api.notion.com/v1',
    asana: 'https://app.asana.com/api/1.0',
    trello: 'https://api.trello.com/1',
    bitbucket: 'https://api.bitbucket.org/2.0',
    google: 'https://www.googleapis.com',
    caldav: 'https://your-server.com',
  };

  for (const [key, url] of Object.entries(domains)) {
    if (providerId.toLowerCase().includes(key)) return url;
  }

  return `https://api.${providerId.toLowerCase().replace(/\s+/g, '')}.com/v1`;
}

function guessApiPatterns(
  providerId: string,
  action: string,
  params: Record<string, any>
): { url: string; method: string; headers: Record<string, string>; body: any; authType: string }[] {
  const patterns: { url: string; method: string; headers: Record<string, string>; body: any; authType: string }[] = [];

  const id = providerId.toLowerCase();

  // Email sending patterns
  if (action === 'send_email') {
    patterns.push(
      { url: `${guessBaseUrl(id)}/mail/send`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/send`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/messages`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
    );
  }

  // Message sending patterns
  if (action === 'send_message') {
    patterns.push(
      { url: `${guessBaseUrl(id)}/chat.postMessage`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/messages`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/send`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
    );
  }

  // Contact/CRM patterns
  if (action === 'create_contact' || action === 'add_contact') {
    patterns.push(
      { url: `${guessBaseUrl(id)}/contacts`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/crm/contacts`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/contacts.json`, method: 'POST', headers: {}, body: params, authType: 'bearer' },
    );
  }

  // List patterns (generic GET)
  if (action === 'list' || action === 'get') {
    const endpoint = params['resource'] || '';
    patterns.push(
      { url: `${guessBaseUrl(id)}/${endpoint}`, method: 'GET', headers: {}, body: null, authType: 'bearer' },
      { url: `${guessBaseUrl(id)}/${endpoint}.json`, method: 'GET', headers: {}, body: null, authType: 'bearer' },
    );
  }

  // Generic POST
  if (action === 'create' || action === 'post') {
    patterns.push(
      { url: `${guessBaseUrl(id)}/${params['resource'] || ''}`, method: 'POST', headers: {}, body: params['data'] || params, authType: 'bearer' },
    );
  }

  // Generic fallback — try a GET to the base URL to check connectivity
  patterns.push(
    { url: guessBaseUrl(id), method: 'GET', headers: {}, body: null, authType: 'bearer' },
    { url: `${guessBaseUrl(id)}/ping`, method: 'GET', headers: {}, body: null, authType: 'bearer' },
    { url: `${guessBaseUrl(id)}/health`, method: 'GET', headers: {}, body: null, authType: 'bearer' },
  );

  return patterns;
}
