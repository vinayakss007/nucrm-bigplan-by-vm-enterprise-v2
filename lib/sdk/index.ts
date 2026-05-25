export { NuCRMClient, NuCRMError } from './client';
export type { NuCRMClientConfig } from './client';
export { WebhookVerifier, WebhookRouter } from './webhooks';
export type { WebhookHandler } from './webhooks';
export { defineModule } from './modules';
export type { ModuleManifest, ModulePage, SettingField } from './modules';
export { BulkOperations } from './bulk';
export { SearchSDK } from './search';
export { FileSDK } from './files';
export { RealtimeSDK } from './realtime';
export type { RealtimeConfig } from './realtime';
export { AuthSDK } from './auth';
export type { AuthConfig } from './auth';
export { BillingSDK } from './billing';
export { TemplateSDK } from './templates';
export * from './types';
export {
  ContactsResource,
  DealsResource,
  LeadsResource,
  CompaniesResource,
  TasksResource,
  TicketsResource,
  InvoicesResource,
  DocumentsResource,
  QuotesResource,
  OrdersResource,
  ContractsResource,
  SubscriptionsResource,
  ServicesResource,
  MeetingsResource,
  ActivitiesResource,
  FormsResource,
  SequencesResource,
  AutomationsResource,
  ReportsResource,
} from './resources';
