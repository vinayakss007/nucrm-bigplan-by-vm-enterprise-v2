import type {
  RequestFn,
  FileUploadInput,
  FileUploadResult,
  FileDownloadResult,
  Document,
  PaginatedResponse,
  ListOptions,
} from './types';

export class FileSDK {
  constructor(private readonly request: RequestFn) {}

  /**
   * Upload a file. The `content` field must be base64-encoded for binary files.
   * The server uses `contentEncoding: 'base64'` to determine decoding.
   *
   * For large files (>10MB), prefer `uploadPresigned()` which provides a direct
   * upload URL that bypasses request body size limits.
   */
  async upload(
    file: FileUploadInput,
    entityType?: string,
    entityId?: string
  ): Promise<FileUploadResult> {
    const body: Record<string, unknown> = {
      name: file.name,
      content: file.content,
      contentEncoding: file.contentEncoding ?? 'base64',
      mimeType: file.mimeType,
    };
    if (entityType) body['entityType'] = entityType;
    if (entityId) body['entityId'] = entityId;
    return this.request<FileUploadResult>('POST', '/files/upload', body);
  }

  /**
   * Get a presigned URL for direct file upload. Use this for large files
   * to bypass API request body size limits. The returned URL accepts a PUT
   * request with the raw file bytes.
   *
   * @param fileName - Name of the file to upload
   * @param mimeType - MIME type of the file
   * @param entityType - Optional entity type to associate with
   * @param entityId - Optional entity ID to associate with
   * @returns Presigned upload URL and the file ID that will be assigned
   */
  async uploadPresigned(
    fileName: string,
    mimeType: string,
    entityType?: string,
    entityId?: string
  ): Promise<{ uploadUrl: string; fileId: string; expiresAt: string }> {
    const body: Record<string, unknown> = { name: fileName, mimeType };
    if (entityType) body['entityType'] = entityType;
    if (entityId) body['entityId'] = entityId;
    return this.request<{ uploadUrl: string; fileId: string; expiresAt: string }>(
      'POST',
      '/files/upload/presigned',
      body
    );
  }

  async download(fileId: string): Promise<FileDownloadResult> {
    return this.request<FileDownloadResult>('GET', `/files/${fileId}/download`);
  }

  async getPresignedUrl(fileId: string, expiresIn?: number): Promise<string> {
    const params: Record<string, string> = {};
    if (expiresIn !== undefined) params['expiresIn'] = String(expiresIn);
    const result = await this.request<{ url: string }>('GET', `/files/${fileId}/presigned`, undefined, params);
    return result.url;
  }

  async list(options?: { entityType?: string; entityId?: string } & ListOptions): Promise<PaginatedResponse<Document>> {
    const params: Record<string, string> = {};
    if (options?.entityType) params['entityType'] = options.entityType;
    if (options?.entityId) params['entityId'] = options.entityId;
    if (options?.page !== undefined) params['page'] = String(options.page);
    if (options?.limit !== undefined) params['limit'] = String(options.limit);
    return this.request<PaginatedResponse<Document>>('GET', '/files', undefined, params);
  }
}
