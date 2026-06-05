import type {
  Service,
  CreateService,
  UpdateService,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class ServicesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Service>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Service>>('GET', '/services', undefined, params);
  }

  async get(id: string): Promise<Service> {
    return this.request<Service>('GET', `/services/${id}`);
  }

  async create(data: CreateService): Promise<Service> {
    return this.request<Service>('POST', '/services', data);
  }

  async update(id: string, data: UpdateService): Promise<Service> {
    return this.request<Service>('PATCH', `/services/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/services/${id}`);
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
