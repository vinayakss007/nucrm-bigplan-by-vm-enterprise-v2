import { createHmac, timingSafeEqual } from 'crypto';
import type { WebhookPayload } from './types';

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
