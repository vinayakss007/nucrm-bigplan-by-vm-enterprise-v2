import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sdk/templates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('getCurrent calls request with GET /templates/current', async () => {
    mockRequest.mockResolvedValue({ template: { id: 't1', name: 'Real Estate' }, modules: ['crm'], features: ['contacts'] });
    const { TemplateSDK } = await import('@/lib/sdk/templates');
    const sdk = new TemplateSDK(mockRequest as any);
    const result = await sdk.getCurrent();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/templates/current');
    expect(result.template.name).toBe('Real Estate');
  });

  it('getAvailableModules calls request with GET /templates/modules', async () => {
    mockRequest.mockResolvedValue([{ id: 'm1', name: 'Email' }]);
    const { TemplateSDK } = await import('@/lib/sdk/templates');
    const sdk = new TemplateSDK(mockRequest as any);
    const result = await sdk.getAvailableModules();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/templates/modules');
    expect(result).toHaveLength(1);
  });

  it('enableModule calls request with POST /templates/modules/:id/enable', async () => {
    mockRequest.mockResolvedValue(undefined);
    const { TemplateSDK } = await import('@/lib/sdk/templates');
    const sdk = new TemplateSDK(mockRequest as any);
    await sdk.enableModule('email');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/templates/modules/email/enable');
  });

  it('getConfig calls request with GET /templates/config', async () => {
    mockRequest.mockResolvedValue({ maxUsers: 10 });
    const { TemplateSDK } = await import('@/lib/sdk/templates');
    const sdk = new TemplateSDK(mockRequest as any);
    const result = await sdk.getConfig();
    expect(mockRequest).toHaveBeenCalledWith('GET', '/templates/config');
    expect(result.maxUsers).toBe(10);
  });
});
