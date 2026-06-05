import type {
  Contract,
  CreateContract,
  UpdateContract,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class ContractsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Contract>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Contract>>('GET', '/contracts', undefined, params);
  }

  async get(id: string): Promise<Contract> {
    return this.request<Contract>('GET', `/contracts/${id}`);
  }

  async create(data: CreateContract): Promise<Contract> {
    return this.request<Contract>('POST', '/contracts', data);
  }

  async update(id: string, data: UpdateContract): Promise<Contract> {
    return this.request<Contract>('PATCH', `/contracts/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/contracts/${id}`);
  }

  async sign(id: string): Promise<Contract> {
    return this.request<Contract>('POST', `/contracts/${id}/sign`);
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
