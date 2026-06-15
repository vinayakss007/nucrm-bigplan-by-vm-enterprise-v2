export type IntegrationCategory = 'email' | 'crm' | 'messaging' | 'storage' | 'ai' | 'calendar' | 'analytics' | 'custom';

export interface ProviderCapability {
  action: string;
  label: string;
  description: string;
  inputFields: FieldDef[];
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'select' | 'boolean' | 'number' | 'json';
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  icon: string;
  docsUrl?: string;
  configFields: FieldDef[];
  capabilities: ProviderCapability[];
  defaultBaseUrl?: string;
  builtIn: boolean;
}

export interface IntegrationInstance {
  id: string;
  tenantId: string;
  providerId: string;
  label: string;
  config: Record<string, string>;
  enabled: boolean;
  lastUsedAt?: string;
  createdAt: string;
  provider?: ProviderDefinition;
}

export interface ActionResult {
  success: boolean;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any;
}

export interface ActionRequest {
  instanceId: string;
  action: string;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>;
}
