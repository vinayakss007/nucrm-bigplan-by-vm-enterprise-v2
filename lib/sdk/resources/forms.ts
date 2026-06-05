import type {
  Form,
  FormSubmission,
  CreateForm,
  UpdateForm,
  ListOptions,
  PaginatedResponse,
  RequestFn,
} from '../types';

export class FormsResource {
  constructor(private readonly request: RequestFn) {}

  async list(options?: ListOptions): Promise<PaginatedResponse<Form>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<Form>>('GET', '/forms', undefined, params);
  }

  async get(id: string): Promise<Form> {
    return this.request<Form>('GET', `/forms/${id}`);
  }

  async create(data: CreateForm): Promise<Form> {
    return this.request<Form>('POST', '/forms', data);
  }

  async update(id: string, data: UpdateForm): Promise<Form> {
    return this.request<Form>('PATCH', `/forms/${id}`, data);
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/forms/${id}`);
  }

  async getSubmissions(formId: string, options?: ListOptions): Promise<PaginatedResponse<FormSubmission>> {
    const params = this.buildParams(options);
    return this.request<PaginatedResponse<FormSubmission>>('GET', `/forms/${formId}/submissions`, undefined, params);
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
