import type {
  RequestFn,
  SearchResult,
  SearchFilter,
  SearchOptions,
  PaginatedResponse,
} from './types';

export class SearchSDK {
  constructor(private readonly request: RequestFn) {}

  async global(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const params: Record<string, string> = { q: query };
    if (options?.entities) params['entities'] = options.entities.join(',');
    if (options?.limit !== undefined) params['limit'] = String(options.limit);
    if (options?.offset !== undefined) params['offset'] = String(options.offset);
    return this.request<SearchResult[]>('GET', '/search', undefined, params);
  }

  async advanced<T = unknown>(entity: string, filters: SearchFilter[]): Promise<PaginatedResponse<T>> {
    return this.request<PaginatedResponse<T>>('POST', `/search/${entity}`, { filters });
  }
}
