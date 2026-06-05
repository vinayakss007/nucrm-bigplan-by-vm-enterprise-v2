import type {
  Company,
  CreateCompany,
  UpdateCompany,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class CompaniesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Company>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Company>>('GET', '/companies', undefined, params);
  }

  async get(id: string): Promise<Company> {
    return this.request<Company>('GET', `/companies/${id}`);
  }

  async create(data: CreateCompany): Promise<Company> {
    return this.request<Company>('POST', '/companies', data);
  }

  async update(id: string, data: UpdateCompany): Promise<Company> {
    return this.request<Company>('PATCH', `/companies/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/companies/${id}`);
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
