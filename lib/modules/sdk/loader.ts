/**
 * Dynamic Module Loader
 *
 * Loads modules from multiple sources:
 * 1. Built-in modules (bundled with CRM)
 * 2. External modules (from `modules/` directory)
 * 3. Registered modules (from database)
 * 4. Custom modules (via API)
 */
import type { ModuleManifest } from './types';
import { BUILTIN_MODULES, ModuleRegistry } from '../registry';
import { db } from '@/drizzle/db';
import { modules } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

class ModuleLoader {
  private externalModules: ModuleManifest[] = [];

  /**
   * Register an external module at runtime.
   * Call this in your module's setup file.
   */
  register(manifest: ModuleManifest): void {
    if (this.externalModules.find(m => m.id === manifest.id)) return;
    this.externalModules.push(manifest);
  }

  /**
   * Get all modules (built-in + external + custom)
   */
  getAll(): ModuleManifest[] {
    return [...BUILTIN_MODULES as ModuleManifest[], ...this.externalModules];
  }

  /**
   * Get module by ID
   */
  get(id: string): ModuleManifest | undefined {
    return this.getAll().find(m => m.id === id);
  }

  /**
   * Load modules registered in the database
   */
  async loadFromDB(): Promise<ModuleManifest[]> {
    const rows = await db.select({
      id: modules.id,
      name: modules.name,
      manifest: modules.manifest,
    }).from(modules);

    return rows
      .filter(r => r.manifest && typeof r.manifest === 'object')
      .map(r => {
        const manifest = r.manifest as Record<string, unknown>;
        return {
          id: r.id,
          name: r.name,
          version: manifest.version || '1.0.0',
          description: manifest.description || '',
          category: manifest.category || 'utility',
          icon: manifest.icon || '🔌',
          pricing: manifest.pricing || {},
          features: manifest.features || [],
          permissions: manifest.permissions || [],
          pages: manifest.pages || [],
          settings_schema: manifest.settings_schema || [],
          webhooks: manifest.webhooks || [],
          dependsOn: manifest.dependsOn || [],
          author: manifest.author || 'Unknown',
        } as ModuleManifest;
      });
  }

  /**
   * Check if a module is available for a tenant's plan
   */
  async checkPlanGate(tenantId: string, moduleId: string): Promise<{ ok: boolean; error?: string }> {
    return ModuleRegistry.checkPlanGate(tenantId, moduleId);
  }
}

export const moduleLoader = new ModuleLoader();
export default moduleLoader;
