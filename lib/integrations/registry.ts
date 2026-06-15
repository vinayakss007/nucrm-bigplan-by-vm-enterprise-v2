import type { ProviderDefinition, ActionResult, IntegrationInstance } from './types';
import { sendgridProvider } from './providers/sendgrid';
import { slackProvider } from './providers/slack';
import { mailgunProvider } from './providers/mailgun';
import { openaiProvider } from './providers/openai';
import { aiConnector } from './ai-connector';

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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>
): Promise<ActionResult> {
  const _provider = getProviderDef(instance.providerId);

  // Built-in handler exists?
  const handler = getHandler(instance.providerId);
  if (handler) {
    try {
      return await handler(instance, action, params);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Fallback: AI connector — works with ANY API
  try {
    return await aiConnector(instance, action, params);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return { success: false, error: `AI connector failed: ${err.message}` };
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionHandler = (instance: IntegrationInstance, action: string, params: Record<string, any>) => Promise<ActionResult>;

function getHandler(providerId: string): ActionHandler | undefined {
  const handlers: Record<string, ActionHandler> = {
    sendgrid: handleSendGrid,
    slack: handleSlack,
    mailgun: handleMailgun,
    openai: handleOpenAI,
  };
  return handlers[providerId];
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSendGrid(instance: IntegrationInstance, action: string, params: Record<string, any>): Promise<ActionResult> {
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
    });
    return { success: res.ok, data: await res.json().catch(() => ({})) };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSlack(instance: IntegrationInstance, action: string, params: Record<string, any>): Promise<ActionResult> {
  const token = instance.config['bot_token'];

  if (action === 'send_message') {
    const channel = params['channel'] || instance.config['default_channel'];
    if (!channel || !params['text']) return { success: false, error: 'channel and text are required' };
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text: params['text'] }),
    });
    const data = await res.json();
    return { success: data.ok, data };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMailgun(instance: IntegrationInstance, action: string, params: Record<string, any>): Promise<ActionResult> {
  const apiKey = instance.config['api_key'];
  const domain = instance.config['domain'];
  const baseUrl = instance.config['base_url'] || 'https://api.mailgun.net/v3';

  if (action === 'send_email') {
    const formData = new URLSearchParams();
    const fromEmail = instance.config['from_email'] || 'noreply@domain.com';
    formData.append('from', instance.config['from_name']
      ? `${instance.config['from_name']} <${fromEmail}>`
      : fromEmail);
    formData.append('to', params['to']);
    formData.append('subject', params['subject']);
    formData.append('html', params['body']);

    const res = await fetch(`${baseUrl}/${domain}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${btoa(`api:${apiKey}`)}` },
      body: formData,
    });
    const data = await res.json();
    return { success: res.ok, data };
  }

  return { success: false, error: `Unknown action: ${action}` };
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOpenAI(instance: IntegrationInstance, action: string, params: Record<string, any>): Promise<ActionResult> {
  const apiKey = instance.config['api_key'];
  const model = instance.config['model'] || 'gpt-4o-mini';
  const baseUrl = 'https://api.openai.com/v1';

  if (action === 'generate') {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: params['prompt'] }],
        temperature: params['temperature'] ?? 0.7,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error?.message };
    return { success: true, data: { text: data.choices?.[0]?.message?.content } };
  }

  if (action === 'summarize') {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: `Please summarize the following text concisely:\n\n${params['text']}` }],
        temperature: 0.3,
      }),
    });
    const data = await res.json();
    return { success: true, data: { summary: data.choices?.[0]?.message?.content } };
  }

  if (action === 'draft_email') {
    const tone = params['tone'] || 'professional';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: `Write a ${tone} email reply to this conversation:\n\n${params['context']}\n\nWrite only the email body, no preamble.`
        }],
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    return { success: true, data: { draft: data.choices?.[0]?.message?.content } };
  }

  return { success: false, error: `Unknown action: ${action}` };
}
