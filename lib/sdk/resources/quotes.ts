import type {
  Quote,
  CreateQuote,
  UpdateQuote,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class QuotesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Quote>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Quote>>('GET', '/quotes', undefined, params);
  }

  async get(id: string): Promise<Quote> {
    return this.request<Quote>('GET', `/quotes/${id}`);
  }

  async create(data: CreateQuote): Promise<Quote> {
    return this.request<Quote>('POST', '/quotes', data);
  }

  async update(id: string, data: UpdateQuote): Promise<Quote> {
    return this.request<Quote>('PATCH', `/quotes/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/quotes/${id}`);
  }

  async accept(id: string): Promise<Quote> {
    return this.request<Quote>('POST', `/quotes/${id}/accept`);
  }

  async reject(id: string): Promise<Quote> {
    return this.request<Quote>('POST', `/quotes/${id}/reject`);
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
