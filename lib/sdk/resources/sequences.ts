import type {
  Sequence,
  CreateSequence,
  UpdateSequence,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class SequencesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Sequence>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Sequence>>('GET', '/sequences', undefined, params);
  }

  async get(id: string): Promise<Sequence> {
    return this.request<Sequence>('GET', `/sequences/${id}`);
  }

  async create(data: CreateSequence): Promise<Sequence> {
    return this.request<Sequence>('POST', '/sequences', data);
  }

  async update(id: string, data: UpdateSequence): Promise<Sequence> {
    return this.request<Sequence>('PATCH', `/sequences/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/sequences/${id}`);
  }

  async enroll(id: string, contactIds: string[]): Promise<{ enrolled: number }> {
    return this.request<{ enrolled: number }>('POST', `/sequences/${id}/enroll`, { contactIds });
  }

  async unenroll(id: string, contactIds: string[]): Promise<{ unenrolled: number }> {
    return this.request<{ unenrolled: number }>('POST', `/sequences/${id}/unenroll`, { contactIds });
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
