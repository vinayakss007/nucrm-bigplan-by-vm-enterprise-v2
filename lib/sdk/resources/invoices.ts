import type {
  Invoice,
  CreateInvoice,
  UpdateInvoice,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class InvoicesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Invoice>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Invoice>>('GET', '/invoices', undefined, params);
  }

  async get(id: string): Promise<Invoice> {
    return this.request<Invoice>('GET', `/invoices/${id}`);
  }

  async create(data: CreateInvoice): Promise<Invoice> {
    return this.request<Invoice>('POST', '/invoices', data);
  }

  async update(id: string, data: UpdateInvoice): Promise<Invoice> {
    return this.request<Invoice>('PATCH', `/invoices/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/invoices/${id}`);
  }

  async markPaid(id: string, amount: string, method?: string): Promise<Invoice> {
    return this.request<Invoice>('POST', `/invoices/${id}/pay`, { amount, method });
  }

  async send(id: string): Promise<Invoice> {
    return this.request<Invoice>('POST', `/invoices/${id}/send`);
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
