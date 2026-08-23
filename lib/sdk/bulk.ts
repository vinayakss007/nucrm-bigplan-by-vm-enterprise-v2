/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { RequestFn, BulkCreateResult, BulkUpdateResult, BulkDeleteResult } from './types';

export class BulkOperations {
  constructor(private readonly request: RequestFn) {}

  async createMany<T>(resource: string, items: T[]): Promise<BulkCreateResult> {
    return this.request<BulkCreateResult>('POST', `/${resource}/bulk`, { items });
  }

  async updateMany<T>(resource: string, ids: string[], data: Partial<T>): Promise<BulkUpdateResult> {
    return this.request<BulkUpdateResult>('PATCH', `/${resource}/bulk`, { ids, data });
  }

  async deleteMany(resource: string, ids: string[]): Promise<BulkDeleteResult> {
    return this.request<BulkDeleteResult>('DELETE', `/${resource}/bulk`, { ids });
  }
}
