/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { unwrapEnvelope } from '../envelope';
import type {
  Document,
  CreateStoredDocument,
  UpdateDocument,
  DocumentDetail,
  DocumentListOptions,
  DocumentPage,
  DocumentUploadResult,
  RequestFn,
} from '../types';

export class DocumentsResource {
  constructor(private readonly request: RequestFn) {}

  /** Catalog of stored documents plus folders. The response keeps its page envelope. */
  async list(options?: DocumentListOptions): Promise<DocumentPage> {
    const params: Record<string, string> = {};
    if (options?.page !== undefined) params['page'] = String(options.page);
    if (options?.limit !== undefined) params['limit'] = String(options.limit);
    if (options?.sort) params['sort'] = options.sort;
    if (options?.order) params['order'] = options.order;
    if (options?.search) params['search'] = options.search;
    if (options?.filters) params['filters'] = JSON.stringify(options.filters);
    if (options?.entityType) params['entityType'] = options.entityType;
    if (options?.entityId) params['entityId'] = options.entityId;
    if (options?.folderId) params['folderId'] = options.folderId;
    return this.request<DocumentPage>('GET', '/documents', undefined, params);
  }

  /** Metadata + a 10-minute signed download URL for one stored document. */
  async get(id: string): Promise<DocumentDetail> {
    const body = await this.request<unknown>('GET', `/documents/${id}`);
    return unwrapEnvelope<DocumentDetail>(body);
  }

  /** Creates metadata and returns a presigned PUT URL; the upload must then be PUT to it. */
  async create(data: CreateStoredDocument): Promise<DocumentUploadResult> {
    const body = await this.request<unknown>('POST', '/documents', data);
    return unwrapEnvelope<DocumentUploadResult>(body);
  }

  async update(id: string, data: UpdateDocument): Promise<Document> {
    return this.request<Document>('PATCH', `/documents/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/documents/${id}`);
  }
}
