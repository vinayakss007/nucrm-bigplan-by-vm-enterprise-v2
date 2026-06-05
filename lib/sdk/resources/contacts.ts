import type {
  Contact,
  CreateContact,
  UpdateContact,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class ContactsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Contact>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Contact>>('GET', '/contacts', undefined, params);
  }

  async get(id: string): Promise<Contact> {
    return this.request<Contact>('GET', `/contacts/${id}`);
  }

  async create(data: CreateContact): Promise<Contact> {
    return this.request<Contact>('POST', '/contacts', data);
  }

  async update(id: string, data: UpdateContact): Promise<Contact> {
    return this.request<Contact>('PATCH', `/contacts/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/contacts/${id}`);
  }

  async bulkUpdate(ids: string[], data: UpdateContact): Promise<{ updated: number }> {
    return this.request<{ updated: number }>('PATCH', '/contacts/bulk', { ids, ...data });
  }

  async search(query: string, options?: ListOptions): Promise<PaginatedResponse<Contact>> {
    const params = this.buildParams({ ...options, search: query });
    return this.request<PaginatedResponse<Contact>>('GET', '/contacts', undefined, params);
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
