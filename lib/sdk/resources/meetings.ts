import type {
  Meeting,
  CreateMeeting,
  UpdateMeeting,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class MeetingsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Meeting>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Meeting>>('GET', '/meetings', undefined, params);
  }

  async get(id: string): Promise<Meeting> {
    return this.request<Meeting>('GET', `/meetings/${id}`);
  }

  async create(data: CreateMeeting): Promise<Meeting> {
    return this.request<Meeting>('POST', '/meetings', data);
  }

  async update(id: string, data: UpdateMeeting): Promise<Meeting> {
    return this.request<Meeting>('PATCH', `/meetings/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/meetings/${id}`);
  }

  async cancel(id: string): Promise<Meeting> {
    return this.request<Meeting>('POST', `/meetings/${id}/cancel`);
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
