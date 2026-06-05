import type {
  Task,
  CreateTask,
  UpdateTask,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class TasksResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Task>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Task>>('GET', '/tasks', undefined, params);
  }

  async get(id: string): Promise<Task> {
    return this.request<Task>('GET', `/tasks/${id}`);
  }

  async create(data: CreateTask): Promise<Task> {
    return this.request<Task>('POST', '/tasks', data);
  }

  async update(id: string, data: UpdateTask): Promise<Task> {
    return this.request<Task>('PATCH', `/tasks/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/tasks/${id}`);
  }

  async complete(id: string): Promise<Task> {
    return this.request<Task>('POST', `/tasks/${id}/complete`);
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
