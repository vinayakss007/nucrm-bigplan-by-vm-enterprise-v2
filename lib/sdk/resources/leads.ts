import type {
  Lead,
  CreateLead,
  UpdateLead,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class LeadsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Lead>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Lead>>('GET', '/leads', undefined, params);
  }

  async get(id: string): Promise<Lead> {
    return this.request<Lead>('GET', `/leads/${id}`);
  }

  async create(data: CreateLead): Promise<Lead> {
    return this.request<Lead>('POST', '/leads', data);
  }

  async update(id: string, data: UpdateLead): Promise<Lead> {
    return this.request<Lead>('PATCH', `/leads/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/leads/${id}`);
  }

  async convert(id: string): Promise<Lead> {
    return this.request<Lead>('POST', `/leads/${id}/convert`);
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
