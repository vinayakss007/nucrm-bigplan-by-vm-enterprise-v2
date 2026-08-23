/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { RequestFn, IndustryTemplate, ModuleInfo } from './types';

export class TemplateSDK {
  constructor(private readonly request: RequestFn) {}

  async getCurrent(): Promise<{ template: IndustryTemplate; modules: string[]; features: string[] }> {
    return this.request<{ template: IndustryTemplate; modules: string[]; features: string[] }>(
      'GET',
      '/templates/current'
    );
  }

  async getAvailableModules(): Promise<ModuleInfo[]> {
    return this.request<ModuleInfo[]>('GET', '/templates/modules');
  }

  async enableModule(moduleId: string): Promise<void> {
    await this.request<void>('POST', `/templates/modules/${moduleId}/enable`);
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/templates/config');
  }
}
