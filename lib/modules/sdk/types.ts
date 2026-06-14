/**
 * NuCRM Module SDK
 *
 * Build standalone mini-SaaS apps that plug into the CRM platform.
 * Each module is a self-contained app with its own:
 *   - Pages (routing)
 *   - API routes
 *   - Database tables
 *   - Permissions (RBAC)
 *   - Settings UI
 *   - Pricing model
 *
 * @example
 * ```ts
 * // my-whatsapp-module/index.ts
 * import { defineModule } from '@/lib/modules/sdk/types';
 *
 * export default defineModule({
 *   id: 'whatsapp-automation',
 *   name: 'WhatsApp Automation',
 *   version: '1.0.0',
 *   description: 'Send WhatsApp messages, auto-replies, campaigns',
 *   category: 'messaging',
 *   icon: '💬',
 *   pricing: {
 *     free: { enabled: false },
 *     starter: { enabled: true, price: 19 },
 *     pro: { enabled: true, price: 19 },
 *     enterprise: { enabled: true, price: 0 },
 *   },
 *   features: [
 *     'WhatsApp Business API',
 *     'Template messages',
 *     'Auto-replies',
 *     'Bulk campaigns',
 *     'Analytics dashboard',
 *   ],
 *   permissions: ['whatsapp.view', 'whatsapp.send', 'whatsapp.templates'],
 *   pages: [
 *     { path: '/tenant/whatsapp', label: 'WhatsApp', icon: 'MessageSquare' },
 *     { path: '/tenant/whatsapp/templates', label: 'Templates', icon: 'FileText' },
 *   ],
 *   // DB migration files
 *   migrations: './my-whatsapp-module/migrations',
 *   // Settings that appear in module config
 *   settings_schema: [
 *     { key: 'phone_number_id', label: 'Phone Number ID', type: 'text', required: true },
 *     { key: 'access_token', label: 'Access Token', type: 'password', required: true },
 *   ],
 *   // Webhooks this module listens to
 *   webhooks: ['whatsapp.message_received'],
 *   // Dependencies on other modules
 *   dependsOn: ['core-crm'],
 * });
 * ```
 */

export interface ModulePricingPlan {
  enabled: boolean;
  price?: number;
}

export interface ModuleManifest {
  /** Unique module ID (e.g., 'whatsapp-automation') */
  id: string;
  /** Display name */
  name: string;
  /** Semantic version */
  version: string;
  /** Brief description */
  description: string;
  /** Author / vendor name */
  author?: string;
  /** Category for marketplace */
  category: 'utility' | 'automation' | 'messaging' | 'integration' | 'ai' | 'analytics';
  /** Icon emoji or icon name */
  icon: string;
  /** Minimum CRM version required */
  minCrmVersion?: string;
  /** Plan-level availability and pricing */
  pricing: Record<string, ModulePricingPlan>;
  /** Feature list shown in marketplace */
  features: string[];
  /** Required permissions (auto-created in RBAC) */
  permissions?: string[];
  /** Pages this module adds to the sidebar/routing */
  pages?: ModulePage[];
  /** Settings form schema */
  settings_schema?: SettingField[];
  /** Webhooks this module emits/listens to */
  webhooks?: string[];
  /** Database migration path */
  migrations?: string;
  /** Module dependencies */
  dependsOn?: string[];
}

export interface ModulePage {
  /** Route path */
  path: string;
  /** Navigation label */
  label: string;
  /** Lucide icon name */
  icon: string;
}

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'boolean' | 'number';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest;
}

/**
 * Module plugin interface:
 *
 * Modules declare themselves through the manifest.
 * The CRM platform automatically:
 * 1. Registers their routes
 * 2. Creates permissions
 * 3. Shows them in the marketplace
 * 4. Manages installation per tenant
 * 5. Handles billing via plan gates
 * 6. Provides settings UI from schema
 *
 * Modules can be loaded from:
 * - Built-in (bundled with CRM)
 * - External npm packages
 * - GitHub repos (loaded at runtime)
 * - Local `modules/` directory
 */
export interface ModulePlugin {
  manifest: ModuleManifest;
  /** Called when module is installed for a tenant */
  onInstall?: (tenantId: string) => Promise<void>;
  /** Called when module is uninstalled */
  onUninstall?: (tenantId: string) => Promise<void>;
  /** Called on every request to check access */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  middleware?: (req: any) => Promise<boolean>;
}
