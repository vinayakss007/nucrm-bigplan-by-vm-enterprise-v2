import { describe, it, expect, vi } from 'vitest';

describe('sdk/webhooks', () => {
  it('WebhookVerifier.verify returns true for valid signature', async () => {
    const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
    const verifier = new WebhookVerifier('my-secret');
    const payload = JSON.stringify({ event: 'contact.created' });
    const { createHmac } = await import('crypto');
    const expected = createHmac('sha256', 'my-secret').update(payload).digest('hex');
    expect(verifier.verify(payload, expected)).toBe(true);
  });

  it('WebhookVerifier.verify returns false for invalid signature', async () => {
    const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
    const verifier = new WebhookVerifier('my-secret');
    expect(verifier.verify('{"event":"test"}', 'bad-signature')).toBe(false);
  });

  it('WebhookVerifier.verify returns false for different length buffers', async () => {
    const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
    const verifier = new WebhookVerifier('my-secret');
    expect(verifier.verify('payload', 'too-short')).toBe(false);
  });

  it('WebhookVerifier.parse returns parsed payload', async () => {
    const { WebhookVerifier } = await import('@/lib/sdk/webhooks');
    const verifier = new WebhookVerifier('secret');
    const payload = verifier.parse<{ id: string }>('{"event":"test","data":{"id":"123"}}');
    expect(payload.event).toBe('test');
    expect(payload.data).toEqual({ id: '123' });
  });

  it('WebhookRouter.register stores handlers by event type', async () => {
    const { WebhookRouter } = await import('@/lib/sdk/webhooks');
    const router = new WebhookRouter('secret');
    const handler = vi.fn();
    router.register('contact.created', handler);
    const result = await router.handle(
      JSON.stringify({ event: 'contact.created', data: {} }),
      (await import('crypto')).createHmac('sha256', 'secret').update(JSON.stringify({ event: 'contact.created', data: {} })).digest('hex')
    );
    expect(result.acknowledged).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('WebhookRouter.handle returns not acknowledged for bad signature', async () => {
    const { WebhookRouter } = await import('@/lib/sdk/webhooks');
    const router = new WebhookRouter('secret');
    router.register('contact.created', vi.fn());
    const result = await router.handle('{"event":"contact.created","data":{}}', 'bad-sig');
    expect(result.acknowledged).toBe(false);
    expect(result.event).toBe('');
  });

  it('WebhookRouter.handle collects errors from handlers', async () => {
    const { WebhookRouter } = await import('@/lib/sdk/webhooks');
    const router = new WebhookRouter('secret');
    const failingHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
    router.register('deal.won', failingHandler);
    const payload = JSON.stringify({ event: 'deal.won', data: { id: 'd-1' } });
    const { createHmac } = await import('crypto');
    const sig = createHmac('sha256', 'secret').update(payload).digest('hex');
    const result = await router.handle(payload, sig);
    expect(result.acknowledged).toBe(true);
    expect(result.errors).toEqual(['Handler failed']);
  });

  it('WebhookRouter.handle returns success for unregistered events', async () => {
    const { WebhookRouter } = await import('@/lib/sdk/webhooks');
    const router = new WebhookRouter('secret');
    const payload = JSON.stringify({ event: 'unknown.event', data: {} });
    const { createHmac } = await import('crypto');
    const sig = createHmac('sha256', 'secret').update(payload).digest('hex');
    const result = await router.handle(payload, sig);
    expect(result.acknowledged).toBe(true);
    expect(result.event).toBe('unknown.event');
    expect(result.errors).toBeUndefined();
  });

  it('WebhookRouter.handle supports multiple handlers for same event', async () => {
    const { WebhookRouter } = await import('@/lib/sdk/webhooks');
    const router = new WebhookRouter('secret');
    const h1 = vi.fn();
    const h2 = vi.fn();
    router.register('lead.created', h1);
    router.register('lead.created', h2);
    const payload = JSON.stringify({ event: 'lead.created', data: { id: 'l-1' } });
    const { createHmac } = await import('crypto');
    const sig = createHmac('sha256', 'secret').update(payload).digest('hex');
    await router.handle(payload, sig);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
