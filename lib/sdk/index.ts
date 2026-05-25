export { NuCRMClient, NuCRMError } from './client';
export type { NuCRMClientConfig } from './client';
export { WebhookVerifier } from './webhooks';
export { defineModule } from './modules';
export type { ModuleManifest, ModulePage, SettingField } from './modules';
export * from './types';
export {
  ContactsResource,
  DealsResource,
  LeadsResource,
  CompaniesResource,
  TasksResource,
  TicketsResource,
  InvoicesResource,
} from './resources';
