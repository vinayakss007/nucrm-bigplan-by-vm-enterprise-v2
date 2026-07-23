/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { TemplateSDK } from '@/lib/sdk/templates';

function makeMockRequest(responses: Record<string, any> = {}) {
  return vi.fn(async (method: string, path: string, _body?: unknown) => {
    const key = `${method} ${path}`;
    if (key in responses) return responses[key];
    throw new Error(`Unexpected request: ${key}`);
  });
}

describe('TemplateSDK', () => {
  it('getCurrent calls GET /templates/current', async () => {
    const mockData = {
      template: { id: 'real-estate', name: 'Real Estate', description: 'CRM for RE', modules: ['listings'], features: ['lead-capture'] },
      modules: ['listings'],
      features: ['lead-capture'],
    };
    const request = makeMockRequest({ 'GET /templates/current': mockData });
    const sdk = new TemplateSDK(request);
    const result = await sdk.getCurrent();
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('GET', '/templates/current');
  });

  it('getAvailableModules calls GET /templates/modules', async () => {
    const mockData = [
      { id: 'listings', name: 'Listings', description: 'Property listings', category: 'utility', enabled: true },
      { id: 'contracts', name: 'Contracts', description: 'Contract management', category: 'automation', enabled: false },
    ];
    const request = makeMockRequest({ 'GET /templates/modules': mockData });
    const sdk = new TemplateSDK(request);
    const result = await sdk.getAvailableModules();
    expect(result).toEqual(mockData);
    expect(result).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('GET', '/templates/modules');
  });

  it('enableModule calls POST /templates/modules/{id}/enable', async () => {
    const request = makeMockRequest({ 'POST /templates/modules/listings/enable': undefined });
    const sdk = new TemplateSDK(request);
    await sdk.enableModule('listings');
    expect(request).toHaveBeenCalledWith('POST', '/templates/modules/listings/enable');
  });

  it('getConfig calls GET /templates/config', async () => {
    const mockData = { theme: 'dark', language: 'en' };
    const request = makeMockRequest({ 'GET /templates/config': mockData });
    const sdk = new TemplateSDK(request);
    const result = await sdk.getConfig();
    expect(result).toEqual(mockData);
    expect(request).toHaveBeenCalledWith('GET', '/templates/config');
  });

  it('propagates errors from request function', async () => {
    const request = vi.fn(async () => { throw new Error('Server error'); });
    const sdk = new TemplateSDK(request);
    await expect(sdk.getCurrent()).rejects.toThrow('Server error');
  });

  it('enableModule with different module IDs', async () => {
    const request = makeMockRequest({
      'POST /templates/modules/invoicing/enable': undefined,
      'POST /templates/modules/calendar/enable': undefined,
    });
    const sdk = new TemplateSDK(request);
    await sdk.enableModule('invoicing');
    await sdk.enableModule('calendar');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('POST', '/templates/modules/invoicing/enable');
    expect(request).toHaveBeenCalledWith('POST', '/templates/modules/calendar/enable');
  });
});
