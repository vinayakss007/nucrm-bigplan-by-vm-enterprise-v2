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

  async upload(
    file: FileUploadInput,
    entityType?: string,
    entityId?: string
  ): Promise<FileUploadResult> {
    const body: Record<string, unknown> = {
      name: file.name,
      content: file.content,
      mimeType: file.mimeType,
    };
    if (entityType) body['entityType'] = entityType;
    if (entityId) body['entityId'] = entityId;
    return this.request<FileUploadResult>('POST', '/files/upload', body);
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
