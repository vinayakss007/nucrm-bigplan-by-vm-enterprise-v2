import type {
  Document,
  CreateDocument,
  UpdateDocument,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class DocumentsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Document>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Document>>('GET', '/documents', undefined, params);
  }

  async get(id: string): Promise<Document> {
    return this.request<Document>('GET', `/documents/${id}`);
  }

  async create(data: CreateDocument): Promise<Document> {
    return this.request<Document>('POST', '/documents', data);
  }

  async update(id: string, data: UpdateDocument): Promise<Document> {
    return this.request<Document>('PATCH', `/documents/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/documents/${id}`);
  }

  private buildParams(options?: ListOptions): Record<string, string> {
    const params: Record<string, string> = {};
    if (!options) return params;
    if (options.page !== undefined) params['page'] = String(options.page);
    if (options.limit !== undefined) params['limit'] = String(options.limit);
    if (options.sort) params['sort'] = options.sort;
    if (options.order) params['order'] = options.order;
    if (options.search) params['search'] = options.search;
    if (options.filters) params['filters'] = JSON.stringify(options.filters);
    return params;
  }
}
