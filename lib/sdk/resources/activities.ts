import type {
  Activity,
  CreateActivity,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class ActivitiesResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Activity>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Activity>>('GET', '/activities', undefined, params);
  }

  async get(id: string): Promise<Activity> {
    return this.request<Activity>('GET', `/activities/${id}`);
  }

  async create(data: CreateActivity): Promise<Activity> {
    return this.request<Activity>('POST', '/activities', data);
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
