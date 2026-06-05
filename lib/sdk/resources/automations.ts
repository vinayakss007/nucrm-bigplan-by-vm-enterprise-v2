import type {
  Automation,
  CreateAutomation,
  UpdateAutomation,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class AutomationsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Automation>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Automation>>('GET', '/automations', undefined, params);
  }

  async get(id: string): Promise<Automation> {
    return this.request<Automation>('GET', `/automations/${id}`);
  }

  async create(data: CreateAutomation): Promise<Automation> {
    return this.request<Automation>('POST', '/automations', data);
  }

  async update(id: string, data: UpdateAutomation): Promise<Automation> {
    return this.request<Automation>('PATCH', `/automations/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/automations/${id}`);
  }

  async trigger(id: string, data?: Record<string, unknown>): Promise<{ runId: string }> {
    return this.request<{ runId: string }>('POST', `/automations/${id}/trigger`, data);
  }

  async pause(id: string): Promise<Automation> {
    return this.request<Automation>('POST', `/automations/${id}/pause`);
  }

  async resume(id: string): Promise<Automation> {
    return this.request<Automation>('POST', `/automations/${id}/resume`);
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
