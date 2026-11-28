/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { ProviderDefinition, ActionResult, IntegrationInstance } from './types';
import { sendgridProvider } from './providers/sendgrid';
import { slackProvider } from './providers/slack';
import { mailgunProvider } from './providers/mailgun';
import { openaiProvider } from './providers/openai';
import { aiConnector } from './ai-connector';
import { safeFetch } from '@/lib/security/ssrf';

const builtInProviders: ProviderDefinition[] = [
  sendgridProvider,
  slackProvider,
  mailgunProvider,
  openaiProvider,
];

export function getProviderDef(id: string): ProviderDefinition | undefined {
  return builtInProviders.find(p => p.id === id);
}

export function getAllProviders(): ProviderDefinition[] {
  return builtInProviders;
}

export async function executeAction(
  instance: IntegrationInstance,
  action: string,
  params: Record<string, unknown>
): Promise<ActionResult> {
  const _provider = getProviderDef(instance.providerId);

  // Built-in handler exists?
  const handler = getHandler(instance.providerId);
  if (handler) {
    try {
      return await handler(instance, action, params);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Fallback: AI connector — works with ANY API
  try {
    return await aiConnector(instance, action, params);
  } catch (err) {
    return { success: false, error: `AI connector failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type ActionHandler = (instance: IntegrationInstance, action: string, params: Record<string, unknown>) => Promise<ActionResult>;

function getHandler(providerId: string): ActionHandler | undefined {
  const handlers: Record<string, ActionHandler> = {
    sendgrid: handleSendGrid,
    slack: handleSlack,
    mailgun: handleMailgun,
    openai: handleOpenAI,
  };
  return handlers[providerId];
}

async function handleSendGrid(instance: IntegrationInstance, action: string, params: Record<string, unknown>): Promise<ActionResult> {
  const apiKey = instance.config['api_key'];
  const baseUrl = 'https://api.sendgrid.com/v3';

  if (action === 'send_email') {
    const fromEmail = instance.config['from_email'];
    const fromName = instance.config['from_name'] || 'NuCRM';
    if (!params['to'] || !params['subject'] || !params['body']) {
      return { success: false, error: 'to, subject, and body are required' };
    }
    const res = await fetch(`${baseUrl}/mail/send`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: params['to'] }] }],
        from: { email: fromEmail, name: fromName },
        subject: params['subject'],
        content: [{ type: 'text/html', value: params['body'] }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `SendGrid API error: ${err}` };
    }
    return { success: true, data: { message_id: res.headers.get('x-message-id') } };
  }

  if (action === 'add_contact') {
    const res = await fetch(`${baseUrl}/marketing/contacts`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contacts: [{
          email: params['email'],
          first_name: params['first_name'],
          last_name: params['last_name'],
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return { success: res.ok, data: await res.json().catch(() => ({ error: `HTTP ${res.status}` })) };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

async function handleSlack(instance: IntegrationInstance, action: string, params: Record<string, unknown>): Promise<ActionResult> {
  const token = instance.config['bot_token'];

  if (action === 'send_message') {
    const channel = params['channel'] || instance.config['default_channel'];
    if (!channel || !params['text']) return { success: false, error: 'channel and text are required' };
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text: params['text'] }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    return { success: data.ok, data };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

/**
 * #3292: the region selector is a choice between the two origins Mailgun
 * actually serves on, written out here — never a host read out of the tenant's
 * `config` bag. An absent selection keeps the documented US default; anything
 * else, including a value that merely looks like a Mailgun host, is refused
 * rather than normalised (#3325: suffix matching in an allowlist accepts
 * `https://api.mailgun.net.evil.test/v3`).
 */
const MAILGUN_US = 'https://api.mailgun.net/v3';
const MAILGUN_EU = 'https://api.eu.mailgun.net/v3';

function mailgunRegion(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return MAILGUN_US;
  if (raw === MAILGUN_US) return MAILGUN_US;
  if (raw === MAILGUN_EU) return MAILGUN_EU;
  return null;
}

async function handleMailgun(instance: IntegrationInstance, action: string, params: Record<string, unknown>): Promise<ActionResult> {
  const apiKey = instance.config['api_key'];
  const domain = instance.config['domain'];
  const region = mailgunRegion(instance.config['base_url']);

  if (action === 'send_email') {
    if (region === null) {
      return { success: false, error: 'Mailgun base_url must be one of the two declared API regions (#3292)' };
    }
    const formData = new URLSearchParams();
    const fromEmail = instance.config['from_email'] || 'noreply@domain.com';
    formData.append('from', instance.config['from_name']
      ? `${instance.config['from_name']} <${fromEmail}>`
      : fromEmail);
    formData.append('to', String(params['to']));
    formData.append('subject', String(params['subject']));
    formData.append('html', String(params['body']));

    // `domain` is tenant data too, and it lands in a path segment: encoded so it
    // cannot climb out of `/v3/<domain>/` into a different Mailgun route.
    const res = await safeFetch(`${region}/${encodeURIComponent(String(domain))}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${btoa(`api:${apiKey}`)}` },
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    return { success: res.ok, data };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

async function openAiCompletion(
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'OpenAI request failed' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `OpenAI returned HTTP ${res.status}`;
    return { ok: false, error: message };
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'OpenAI returned no completion text' };
  }
  return { ok: true, text };
}

async function handleOpenAI(instance: IntegrationInstance, action: string, params: Record<string, unknown>): Promise<ActionResult> {
  const apiKey = String(instance.config['api_key'] ?? '');
  const model = String(instance.config['model'] || 'gpt-4o-mini');

  if (action === 'generate') {
    const result = await openAiCompletion(apiKey, model, String(params['prompt'] ?? ''), Number(params['temperature'] ?? 0.7));
    return result.ok ? { success: true, data: { text: result.text } } : { success: false, error: result.error };
  }

  if (action === 'summarize') {
    const result = await openAiCompletion(apiKey, model, `Please summarize the following text concisely:\n\n${String(params['text'] ?? '')}`, 0.3);
    return result.ok ? { success: true, data: { summary: result.text } } : { success: false, error: result.error };
  }

  if (action === 'draft_email') {
    const tone = params['tone'] || 'professional';
    const result = await openAiCompletion(
      apiKey,
      model,
      `Write a ${tone} email reply to this conversation:\n\n${String(params['context'] ?? '')}\n\nWrite only the email body, no preamble.`,
      0.7,
    );
    return result.ok ? { success: true, data: { draft: result.text } } : { success: false, error: result.error };
  }

  return { success: false, error: `Unknown action: ${action}` };
}
