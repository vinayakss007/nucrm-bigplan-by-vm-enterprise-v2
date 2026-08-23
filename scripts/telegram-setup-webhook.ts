#!/usr/bin/env node
/**
 * Register your Telegram bot webhook.
 * Run this ONCE after deploying to set the webhook URL.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx npm run telegram:setup-webhook
 *
 * Or set the webhook manually:
 *   https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://yourdomain.com/api/webhooks/telegram/bot
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!url) {
  console.error('❌ WEBHOOK_URL or NEXT_PUBLIC_APP_URL is required');
  process.exit(1);
}

const webhookUrl = `${url.replace(/\/$/, '')}/api/webhooks/telegram/bot`;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!webhookSecret) {
  console.error('❌ TELEGRAM_WEBHOOK_SECRET is required (fail-closed webhook verification)');
  process.exit(1);
}

async function main() {
  console.log(`Registering webhook: ${webhookUrl}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret }),
  });

  const data = await res.json();

  if (data.ok) {
    console.log('✅ Webhook registered successfully');
    console.log(`   Bot will POST to: ${webhookUrl}`);
  } else {
    console.error('❌ Failed:', data.description);
    process.exit(1);
  }
}

main();
