import { createHmac, timingSafeEqual } from 'crypto';
import type { WebhookPayload, WebhookEventType } from './types';

export class WebhookVerifier {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /**
   * Verify a webhook signature using HMAC-SHA256.
   * The signature should be a hex-encoded HMAC of the raw payload body.
   */
  verify(payload: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    try {
      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');

      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Parse a webhook payload string into a typed WebhookPayload object.
   */
  parse<T>(payload: string): WebhookPayload<T> {
    return JSON.parse(payload) as WebhookPayload<T>;
  }
}

export type WebhookHandler = (payload: WebhookPayload) => Promise<void>;

export class WebhookRouter {
  private readonly verifier: WebhookVerifier;
  private readonly handlers: Map<WebhookEventType, WebhookHandler[]> = new Map();

  constructor(secret: string) {
    this.verifier = new WebhookVerifier(secret);
  }

  register(event: WebhookEventType, handler: WebhookHandler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(event, [handler]);
    }
  }

  async handle(rawBody: string, signature: string): Promise<{ acknowledged: boolean; event: string }> {
    const valid = this.verifier.verify(rawBody, signature);
    if (!valid) {
      return { acknowledged: false, event: '' };
    }

    const payload = this.verifier.parse(rawBody);
    const handlers = this.handlers.get(payload.event);

    if (handlers) {
      for (const handler of handlers) {
        await handler(payload);
      }
    }

    return { acknowledged: true, event: payload.event };
  }
}
