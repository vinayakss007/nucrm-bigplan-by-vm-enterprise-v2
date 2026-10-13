/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { ProviderDefinition } from '../types';

/**
 * The "bring your own REST API" entry in the integrations picker.
 *
 * It lives here rather than as a literal inside `app/tenant/integrations/page.tsx`
 * so that the secret metadata on `api_key` is visible to
 * `tests/unit/integrations-fielddef-secret-2564.test.ts`, which walks every
 * `FieldDef` the product can render and asserts that its `secret` flag agrees with
 * `SECRET_CONFIG_KEY`. A definition parked in a client component is the one field a
 * registry-wide guard cannot see — and this is the provider whose credential field
 * has the least disciplined name (`api_key`, entered by hand, for an API nobody
 * reviewed).
 *
 * Not in `builtInProviders` (`lib/integrations/registry.ts`) on purpose: that list
 * drives the "available integrations" cards and the action-execution handlers, and
 * this provider has neither capabilities nor a handler. The page selects it with the
 * `__custom__` sentinel instead.
 */
export const customApiProvider: ProviderDefinition = {
  id: '__custom__',
  name: 'Custom API',
  description: 'Connect any REST API',
  category: 'custom',
  icon: 'Cloud',
  configFields: [
    { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.example.com/v1' },
    { key: 'api_key', label: 'API Key / Token', type: 'string', required: true, placeholder: 'Your API key', secret: true },
    {
      key: 'auth_type', label: 'Auth Type', type: 'select', options: [
        { label: 'Bearer Token', value: 'bearer' },
        { label: 'Basic Auth', value: 'basic' },
        { label: 'Header-Only', value: 'header' },
      ],
    },
  ],
  capabilities: [],
  builtIn: false,
};
