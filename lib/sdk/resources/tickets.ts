import type {
  Ticket,
  CreateTicket,
  UpdateTicket,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class TicketsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Ticket>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Ticket>>('GET', '/tickets', undefined, params);
  }

  async get(id: string): Promise<Ticket> {
    return this.request<Ticket>('GET', `/tickets/${id}`);
  }

  async create(data: CreateTicket): Promise<Ticket> {
    return this.request<Ticket>('POST', '/tickets', data);
  }

  async update(id: string, data: UpdateTicket): Promise<Ticket> {
    return this.request<Ticket>('PATCH', `/tickets/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/tickets/${id}`);
  }

  async addReply(id: string, content: string): Promise<Ticket> {
    return this.request<Ticket>('POST', `/tickets/${id}/reply`, { content });
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
