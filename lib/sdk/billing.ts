/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { RequestFn, PlanInfo, LimitCheck, UsageReport } from './types';

export class BillingSDK {
  constructor(private readonly request: RequestFn) {}

  async getCurrentPlan(): Promise<PlanInfo> {
    return this.request<PlanInfo>('GET', '/billing/plan');
  }

  async checkLimit(resource: string): Promise<LimitCheck> {
    return this.request<LimitCheck>('GET', `/billing/limits/${resource}`);
  }

  async getUsage(): Promise<UsageReport> {
    return this.request<UsageReport>('GET', '/billing/usage');
  }

  async requestUpgrade(planId: string): Promise<{ url: string }> {
    return this.request<{ url: string }>('POST', '/billing/upgrade', { planId });
  }
}
