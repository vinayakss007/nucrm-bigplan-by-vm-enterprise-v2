import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetStore,
  createPartner,
  getPartnersByTenant,
  getPartnerById,
  registerDeal,
  approveDealRegistration,
  rejectDealRegistration,
  checkConflict,
  calculateCommission,
  getPartnerDashboard,
  getPartnerDealRegistrations,
  Partner,
} from '@/lib/partners/index';

describe('Partner Management', () => {
  beforeEach(() => {
    _resetStore();
  });

  const tenantId = 'tenant-1';

  it('should create a partner and retrieve it by tenant and id', () => {
    const partner = createPartner(tenantId, {
      name: 'Acme Corp',
      email: 'acme@example.com',
      type: 'reseller',
      status: 'active',
      commissionRate: 10,
    });

    expect(partner.id).toBeDefined();
    expect(partner.tenantId).toBe(tenantId);
    expect(partner.name).toBe('Acme Corp');

    const byTenant = getPartnersByTenant(tenantId);
    expect(byTenant).toHaveLength(1);
    expect(byTenant[0].id).toBe(partner.id);

    const byId = getPartnerById(partner.id, tenantId);
    expect(byId).toBeDefined();
    expect(byId?.id).toBe(partner.id);
  });
});

describe('Deal Registration', () => {
  beforeEach(() => {
    _resetStore();
  });

  const tenantId = 'tenant-1';
  let activePartner: Partner;
  let inactivePartner: Partner;

  beforeEach(() => {
    activePartner = createPartner(tenantId, {
      name: 'Active Partner',
      email: 'active@example.com',
      type: 'reseller',
      status: 'active',
      commissionRate: 10,
    });

    inactivePartner = createPartner(tenantId, {
      name: 'Inactive Partner',
      email: 'inactive@example.com',
      type: 'reseller',
      status: 'inactive',
      commissionRate: 10,
    });
  });

  it('should register a new deal for an active partner', () => {
    const deal = registerDeal(activePartner.id, tenantId, {
      dealTitle: 'Big Sale',
      contactName: 'John Doe',
      contactEmail: 'john@example.com',
      expectedValue: 1000,
    });

    expect(deal.id).toBeDefined();
    expect(deal.partnerId).toBe(activePartner.id);
    expect(deal.status).toBe('pending');
    expect(deal.contactEmail).toBe('john@example.com');
  });

  it('should throw when registering a deal for an inactive partner', () => {
    expect(() => {
      registerDeal(inactivePartner.id, tenantId, {
        dealTitle: 'Big Sale',
        contactName: 'John Doe',
        contactEmail: 'john@example.com',
        expectedValue: 1000,
      });
    }).toThrow('Partner is not active');
  });

  it('should throw when registering a deal for a non-existent partner', () => {
    expect(() => {
      registerDeal('non-existent-id', tenantId, {
        dealTitle: 'Big Sale',
        contactName: 'John Doe',
        contactEmail: 'john@example.com',
        expectedValue: 1000,
      });
    }).toThrow('Partner not found');
  });

  it('should approve a deal registration', () => {
    const deal = registerDeal(activePartner.id, tenantId, {
      dealTitle: 'Big Sale',
      contactName: 'John Doe',
      contactEmail: 'john@example.com',
      expectedValue: 1000,
    });

    const approved = approveDealRegistration(deal.id, tenantId, 'approver-1');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('approver-1');
  });

  it('should reject a deal registration', () => {
    const deal = registerDeal(activePartner.id, tenantId, {
      dealTitle: 'Big Sale',
      contactName: 'John Doe',
      contactEmail: 'john@example.com',
      expectedValue: 1000,
    });

    const rejected = rejectDealRegistration(deal.id, tenantId, 'Poor fit');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedReason).toBe('Poor fit');
  });

  it('should check for conflicts with same contact email', () => {
    registerDeal(activePartner.id, tenantId, {
      dealTitle: 'Big Sale',
      contactName: 'John Doe',
      contactEmail: 'conflict@example.com',
      expectedValue: 1000,
    });

    const conflict = checkConflict(tenantId, 'conflict@example.com');
    expect(conflict).not.toBeNull();
    expect(conflict?.contactEmail).toBe('conflict@example.com');

    const noConflict = checkConflict(tenantId, 'unique@example.com');
    expect(noConflict).toBeNull();
  });
});

describe('Commission Calculation', () => {
  it('should calculate percentage commission correctly', () => {
    expect(calculateCommission(1000, 10, 'percentage')).toBe(100);
    expect(calculateCommission(1000, 12.5, 'percentage')).toBe(125);
    expect(calculateCommission(0, 10, 'percentage')).toBe(0);
  });

  it('should calculate flat commission correctly', () => {
    expect(calculateCommission(1000, 50, 'flat')).toBe(50);
    expect(calculateCommission(0, 50, 'flat')).toBe(50);
  });

  it('should throw errors for negative deal amounts or rates', () => {
    expect(() => calculateCommission(-100, 10, 'percentage')).toThrow('Deal amount cannot be negative');
    expect(() => calculateCommission(1000, -10, 'percentage')).toThrow('Commission rate cannot be negative');
  });
});

describe('Partner Dashboard', () => {
  beforeEach(() => {
    _resetStore();
  });

  const tenantId = 'tenant-1';
  let partner: Partner;

  beforeEach(() => {
    partner = createPartner(tenantId, {
      name: 'Active Partner',
      email: 'active@example.com',
      type: 'reseller',
      status: 'active',
      commissionRate: 10,
    });
  });

  it('should fetch correct dashboard metrics', () => {
    // pending deal
    registerDeal(partner.id, tenantId, {
      dealTitle: 'Pending Deal',
      contactName: 'Alice',
      contactEmail: 'alice@example.com',
      expectedValue: 1000,
    });

    // approved deal
    const approvedDeal = registerDeal(partner.id, tenantId, {
      dealTitle: 'Approved Deal',
      contactName: 'Bob',
      contactEmail: 'bob@example.com',
      expectedValue: 2000,
    });
    approveDealRegistration(approvedDeal.id, tenantId, 'approver-1');

    const dashboard = getPartnerDashboard(partner.id, tenantId);

    expect(dashboard.totalDeals).toBe(2);
    expect(dashboard.pipeline).toBe(1000); // Only pending
    expect(dashboard.wonDeals).toBe(1); // Only approved
    expect(dashboard.commission).toBe(200); // 10% of 2000
  });

  it('should fetch all deal registrations for a partner', () => {
    registerDeal(partner.id, tenantId, {
      dealTitle: 'Deal 1',
      contactName: 'Alice',
      contactEmail: 'alice@example.com',
      expectedValue: 1000,
    });

    registerDeal(partner.id, tenantId, {
      dealTitle: 'Deal 2',
      contactName: 'Bob',
      contactEmail: 'bob@example.com',
      expectedValue: 2000,
    });

    const deals = getPartnerDealRegistrations(partner.id, tenantId);
    expect(deals).toHaveLength(2);
  });

  it('should throw when getting dashboard for non-existent partner', () => {
    expect(() => getPartnerDashboard('non-existent', tenantId)).toThrow('Partner not found');
  });
});
