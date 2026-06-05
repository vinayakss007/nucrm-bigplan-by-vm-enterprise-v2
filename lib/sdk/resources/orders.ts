import type {
  Order,
  CreateOrder,
  UpdateOrder,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class OrdersResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Order>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Order>>('GET', '/orders', undefined, params);
  }

  async get(id: string): Promise<Order> {
    return this.request<Order>('GET', `/orders/${id}`);
  }

  async create(data: CreateOrder): Promise<Order> {
    return this.request<Order>('POST', '/orders', data);
  }

  async update(id: string, data: UpdateOrder): Promise<Order> {
    return this.request<Order>('PATCH', `/orders/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/orders/${id}`);
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
