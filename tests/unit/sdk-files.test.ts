import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestFn } from '@/lib/sdk/types';

describe('sdk/files', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const mockRequest = vi.fn();

  it('upload sends file with entityType and entityId', async () => {
    mockRequest.mockResolvedValue({ fileId: 'f-1', url: 'https://files.crm.com/f-1' });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.upload(
      { name: 'doc.pdf', content: 'base64...', mimeType: 'application/pdf' },
      'deal', 'deal-1'
    );
    expect(mockRequest).toHaveBeenCalledWith('POST', '/files/upload', {
      name: 'doc.pdf', content: 'base64...', contentEncoding: 'base64', mimeType: 'application/pdf',
      entityType: 'deal', entityId: 'deal-1',
    });
    expect(result.fileId).toBe('f-1');
  });

  it('upload works without entityType/entityId', async () => {
    mockRequest.mockResolvedValue({ fileId: 'f-2', url: 'https://files.crm.com/f-2' });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    await sdk.upload({ name: 'img.png', content: 'base64...', mimeType: 'image/png' });
    expect(mockRequest).toHaveBeenCalledWith('POST', '/files/upload', {
      name: 'img.png', content: 'base64...', contentEncoding: 'base64', mimeType: 'image/png',
    });
  });

  it('uploadPresigned returns upload URL', async () => {
    mockRequest.mockResolvedValue({ uploadUrl: 'https://presigned.example.com/upload', fileId: 'f-3', expiresAt: '2026-01-01T00:00:00Z' });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.uploadPresigned('video.mp4', 'video/mp4', 'deal', 'deal-2');
    expect(mockRequest).toHaveBeenCalledWith('POST', '/files/upload/presigned', {
      name: 'video.mp4', mimeType: 'video/mp4', entityType: 'deal', entityId: 'deal-2',
    });
    expect(result.uploadUrl).toContain('presigned');
  });

  it('download calls request with file ID', async () => {
    mockRequest.mockResolvedValue({ content: 'base64...', mimeType: 'application/pdf', name: 'doc.pdf' });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.download('f-1');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/files/f-1/download');
    expect(result.name).toBe('doc.pdf');
  });

  it('getPresignedUrl calls request with expiresIn', async () => {
    mockRequest.mockResolvedValue({ url: 'https://presigned.example.com/dl/f-1' });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.getPresignedUrl('f-1', 3600);
    expect(mockRequest).toHaveBeenCalledWith('GET', '/files/f-1/presigned', undefined, { expiresIn: '3600' });
    expect(result).toContain('presigned');
  });

  it('list calls request with options', async () => {
    mockRequest.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    const { FileSDK } = await import('@/lib/sdk/files');
    const sdk = new FileSDK(mockRequest as unknown as RequestFn);
    const result = await sdk.list({ entityType: 'deal', entityId: 'deal-1', page: 1, limit: 10 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/files', undefined, {
      entityType: 'deal', entityId: 'deal-1', page: '1', limit: '10',
    });
    expect(result.total).toBe(0);
  });
});
