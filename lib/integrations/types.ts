/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
export type IntegrationCategory = 'email' | 'crm' | 'messaging' | 'storage' | 'ai' | 'calendar' | 'analytics' | 'custom';

export interface ProviderCapability {
  action: string;
  label: string;
  description: string;
  inputFields: FieldDef[];
}

/**
 * One input the tenant fills in when configuring a provider.
 *
 * `secret` declares that the *value* is a credential (API key, bot token,
 * password) rather than a setting. It is the only sanctioned answer to "is this
 * a secret?" on the client: the install form renders `type` from it, and
 * `SECRET_CONFIG_KEY` in `lib/integrations/config-credentials.ts` decides
 * whether the stored value comes back out on a read.
 *
 * The two must agree. A field marked `secret` that the mask does not strip
 * leaves the credential readable; a field the mask strips that is not marked
 * shows the admin a plain text box for something they will never see again.
 * `tests/unit/integrations-fielddef-secret-2564.test.ts` asserts the equality
 * over every registered provider, so adding a credential without marking it
 * fails CI instead of quietly splitting the two rules again (see #2564).
 *
 * Do not re-derive it from the key name at a call site. Guessing `key.includes
 * ('key')` also matched `monkey_mode`-style settings and missed `password`,
 * which is precisely the drift this field exists to remove.
 */
export interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'select' | 'boolean' | 'number' | 'json';
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  secret?: boolean;
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
 
 
  data?: unknown;
  error?: string;
 
 
  raw?: unknown;
}

export interface ActionRequest {
  instanceId: string;
  action: string;
 
 
  params: Record<string, unknown>;
}
