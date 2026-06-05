import type {
  Deal,
  CreateDeal,
  UpdateDeal,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class DealsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Deal>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Deal>>('GET', '/deals', undefined, params);
  }

  async get(id: string): Promise<Deal> {
    return this.request<Deal>('GET', `/deals/${id}`);
  }

  async create(data: CreateDeal): Promise<Deal> {
    return this.request<Deal>('POST', '/deals', data);
  }

  async update(id: string, data: UpdateDeal): Promise<Deal> {
    return this.request<Deal>('PATCH', `/deals/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/deals/${id}`);
  }

  async moveStage(id: string, stageId: string): Promise<Deal> {
    return this.request<Deal>('PATCH', `/deals/${id}/stage`, { stageId });
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
