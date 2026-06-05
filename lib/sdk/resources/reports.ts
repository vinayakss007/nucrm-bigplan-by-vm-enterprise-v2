import type {
  Report,
  CreateReport,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class ReportsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Report>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Report>>('GET', '/reports', undefined, params);
  }

  async get(id: string): Promise<Report> {
    return this.request<Report>('GET', `/reports/${id}`);
  }

  async create(data: CreateReport): Promise<Report> {
    return this.request<Report>('POST', '/reports', data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/reports/${id}`);
  }

  async run(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('POST', `/reports/${id}/run`);
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
