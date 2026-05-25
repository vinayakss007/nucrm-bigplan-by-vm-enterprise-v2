import type { ApiError, RequestFn } from './types';
import { ContactsResource } from './resources/contacts';
import { DealsResource } from './resources/deals';
import { LeadsResource } from './resources/leads';
import { CompaniesResource } from './resources/companies';
import { TasksResource } from './resources/tasks';
import { TicketsResource } from './resources/tickets';
import { InvoicesResource } from './resources/invoices';

export interface NuCRMClientConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
}

export class NuCRMError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NuCRMError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NuCRMClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  private _contacts: ContactsResource | null = null;
  private _deals: DealsResource | null = null;
  private _leads: LeadsResource | null = null;
  private _companies: CompaniesResource | null = null;
  private _tasks: TasksResource | null = null;
  private _tickets: TicketsResource | null = null;
  private _invoices: InvoicesResource | null = null;

  constructor(config: NuCRMClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  get contacts(): ContactsResource {
    if (!this._contacts) {
      this._contacts = new ContactsResource(this._request.bind(this));
    }
    return this._contacts;
  }

  get deals(): DealsResource {
    if (!this._deals) {
      this._deals = new DealsResource(this._request.bind(this));
    }
    return this._deals;
  }

  get leads(): LeadsResource {
    if (!this._leads) {
      this._leads = new LeadsResource(this._request.bind(this));
    }
    return this._leads;
  }

  get companies(): CompaniesResource {
    if (!this._companies) {
      this._companies = new CompaniesResource(this._request.bind(this));
    }
    return this._companies;
  }

  get tasks(): TasksResource {
    if (!this._tasks) {
      this._tasks = new TasksResource(this._request.bind(this));
    }
    return this._tasks;
  }

  get tickets(): TicketsResource {
    if (!this._tickets) {
      this._tickets = new TicketsResource(this._request.bind(this));
    }
    return this._tickets;
  }

  get invoices(): InvoicesResource {
    if (!this._invoices) {
      this._invoices = new InvoicesResource(this._request.bind(this));
    }
    return this._invoices;
  }

  private async _request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    let url = `${this.baseUrl}/api/tenant${path}`;

    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorData: ApiError | undefined;
        try {
          errorData = (await response.json()) as ApiError;
        } catch {
          // Response body is not JSON
        }

        throw new NuCRMError(
          errorData?.error ?? `Request failed with status ${response.status}`,
          response.status,
          errorData?.code,
          errorData?.details
        );
      }

      // For 204 No Content responses
      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof NuCRMError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new NuCRMError('Request timed out', 408, 'TIMEOUT');
      }
      throw new NuCRMError(
        error instanceof Error ? error.message : 'Unknown error',
        0,
        'NETWORK_ERROR'
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
