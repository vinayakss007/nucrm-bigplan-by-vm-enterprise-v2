import type {
  Subscription,
  CreateSubscription,
  UpdateSubscription,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class SubscriptionsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Subscription>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Subscription>>('GET', '/subscriptions', undefined, params);
  }

  async get(id: string): Promise<Subscription> {
    return this.request<Subscription>('GET', `/subscriptions/${id}`);
  }

  async create(data: CreateSubscription): Promise<Subscription> {
    return this.request<Subscription>('POST', '/subscriptions', data);
  }

  async update(id: string, data: UpdateSubscription): Promise<Subscription> {
    return this.request<Subscription>('PATCH', `/subscriptions/${id}`, data);
  }

  async cancel(id: string): Promise<Subscription> {
    return this.request<Subscription>('POST', `/subscriptions/${id}/cancel`);
  }

  async pause(id: string): Promise<Subscription> {
    return this.request<Subscription>('POST', `/subscriptions/${id}/pause`);
  }

  async resume(id: string): Promise<Subscription> {
    return this.request<Subscription>('POST', `/subscriptions/${id}/resume`);
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
