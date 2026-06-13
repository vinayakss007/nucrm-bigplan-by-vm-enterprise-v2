import type { ApiError, RequestFn } from './types';
import { ContactsResource } from './resources/contacts';
import { DealsResource } from './resources/deals';
import { LeadsResource } from './resources/leads';
import { CompaniesResource } from './resources/companies';
import { TasksResource } from './resources/tasks';
import { TicketsResource } from './resources/tickets';
import { InvoicesResource } from './resources/invoices';
import { DocumentsResource } from './resources/documents';
import { QuotesResource } from './resources/quotes';
import { OrdersResource } from './resources/orders';
import { ContractsResource } from './resources/contracts';
import { SubscriptionsResource } from './resources/subscriptions';
import { ServicesResource } from './resources/services';
import { MeetingsResource } from './resources/meetings';
import { ActivitiesResource } from './resources/activities';
import { FormsResource } from './resources/forms';
import { SequencesResource } from './resources/sequences';
import { AutomationsResource } from './resources/automations';
import { ReportsResource } from './resources/reports';
import { BulkOperations } from './bulk';
import { SearchSDK } from './search';
import { FileSDK } from './files';
import { RealtimeSDK } from './realtime';
import { AuthSDK } from './auth';
import { BillingSDK } from './billing';
import { TemplateSDK } from './templates';

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

  // Existing resources
  private _contacts: ContactsResource | null = null;
  private _deals: DealsResource | null = null;
  private _leads: LeadsResource | null = null;
  private _companies: CompaniesResource | null = null;
  private _tasks: TasksResource | null = null;
  private _tickets: TicketsResource | null = null;
  private _invoices: InvoicesResource | null = null;

  // New resources
  private _documents: DocumentsResource | null = null;
  private _quotes: QuotesResource | null = null;
  private _orders: OrdersResource | null = null;
  private _contracts: ContractsResource | null = null;
  private _subscriptions: SubscriptionsResource | null = null;
  private _services: ServicesResource | null = null;
  private _meetings: MeetingsResource | null = null;
  private _activities: ActivitiesResource | null = null;
  private _forms: FormsResource | null = null;
  private _sequences: SequencesResource | null = null;
  private _automations: AutomationsResource | null = null;
  private _reports: ReportsResource | null = null;

  // SDK modules
  private _bulk: BulkOperations | null = null;
  private _search: SearchSDK | null = null;
  private _files: FileSDK | null = null;
  private _realtime: RealtimeSDK | null = null;
  private _authSDK: AuthSDK | null = null;
  private _billing: BillingSDK | null = null;
  private _templates: TemplateSDK | null = null;

  constructor(config: NuCRMClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
  }

  // ─── Existing Resources ─────────────────────────────────────────────────

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

  // ─── New Resources ──────────────────────────────────────────────────────

  get documents(): DocumentsResource {
    if (!this._documents) {
      this._documents = new DocumentsResource(this._request.bind(this));
    }
    return this._documents;
  }

  get quotes(): QuotesResource {
    if (!this._quotes) {
      this._quotes = new QuotesResource(this._request.bind(this));
    }
    return this._quotes;
  }

  get orders(): OrdersResource {
    if (!this._orders) {
      this._orders = new OrdersResource(this._request.bind(this));
    }
    return this._orders;
  }

  get contracts(): ContractsResource {
    if (!this._contracts) {
      this._contracts = new ContractsResource(this._request.bind(this));
    }
    return this._contracts;
  }

  get subscriptions(): SubscriptionsResource {
    if (!this._subscriptions) {
      this._subscriptions = new SubscriptionsResource(this._request.bind(this));
    }
    return this._subscriptions;
  }

  get services(): ServicesResource {
    if (!this._services) {
      this._services = new ServicesResource(this._request.bind(this));
    }
    return this._services;
  }

  get meetings(): MeetingsResource {
    if (!this._meetings) {
      this._meetings = new MeetingsResource(this._request.bind(this));
    }
    return this._meetings;
  }

  get activities(): ActivitiesResource {
    if (!this._activities) {
      this._activities = new ActivitiesResource(this._request.bind(this));
    }
    return this._activities;
  }

  get forms(): FormsResource {
    if (!this._forms) {
      this._forms = new FormsResource(this._request.bind(this));
    }
    return this._forms;
  }

  get sequences(): SequencesResource {
    if (!this._sequences) {
      this._sequences = new SequencesResource(this._request.bind(this));
    }
    return this._sequences;
  }

  get automations(): AutomationsResource {
    if (!this._automations) {
      this._automations = new AutomationsResource(this._request.bind(this));
    }
    return this._automations;
  }

  get reports(): ReportsResource {
    if (!this._reports) {
      this._reports = new ReportsResource(this._request.bind(this));
    }
    return this._reports;
  }

  // ─── SDK Modules ────────────────────────────────────────────────────────

  get bulk(): BulkOperations {
    if (!this._bulk) {
      this._bulk = new BulkOperations(this._request.bind(this));
    }
    return this._bulk;
  }

  get search(): SearchSDK {
    if (!this._search) {
      this._search = new SearchSDK(this._request.bind(this));
    }
    return this._search;
  }

  get files(): FileSDK {
    if (!this._files) {
      this._files = new FileSDK(this._request.bind(this));
    }
    return this._files;
  }

  get realtime(): RealtimeSDK {
    if (!this._realtime) {
      this._realtime = new RealtimeSDK({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
      });
    }
    return this._realtime;
  }

  get authSDK(): AuthSDK {
    if (!this._authSDK) {
      this._authSDK = new AuthSDK(
        { baseUrl: this.baseUrl, apiKey: this.apiKey },
        this._request.bind(this)
      );
    }
    return this._authSDK;
  }

  get billing(): BillingSDK {
    if (!this._billing) {
      this._billing = new BillingSDK(this._request.bind(this));
    }
    return this._billing;
  }

  get templates(): TemplateSDK {
    if (!this._templates) {
      this._templates = new TemplateSDK(this._request.bind(this));
    }
    return this._templates;
  }

  // ─── Internal Request ───────────────────────────────────────────────────

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
          // Fallback to default on corrupted storage data
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
