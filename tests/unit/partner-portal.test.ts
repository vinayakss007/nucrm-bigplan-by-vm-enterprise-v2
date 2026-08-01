import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPartner,
  registerDeal,
  approveDealRegistration,
  rejectDealRegistration,
  checkConflict,
  calculateCommission,
  getPartnerDashboard,
  getPartnersByTenant,
  getPartnerById,
  getPartnerDealRegistrations,
  _resetStore,
  _getPartners,
} from '@/lib/partners';

describe('Partner Portal', () => {
  beforeEach(() => {
    _resetStore();
  });

  // ─── Partner Management ─────────────────────────────────────

  describe('createPartner', () => {
    it('creates a partner with all required fields', () => {
      const partner = createPartner('tenant-1', {
        name: 'Acme Reseller',
        email: 'partner@acme.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 15,
        metadata: { region: 'US' },
      });

      expect(partner.id).toBeDefined();
      expect(partner.tenantId).toBe('tenant-1');
      expect(partner.name).toBe('Acme Reseller');
      expect(partner.email).toBe('partner@acme.com');
      expect(partner.type).toBe('reseller');
      expect(partner.status).toBe('active');
      expect(partner.commissionRate).toBe(15);
      expect(partner.metadata).toEqual({ region: 'US' });
    });

    it('stores partner in the registry', () => {
      createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'referral',
        status: 'active',
        commissionRate: 10,
      });

      const allPartners = _getPartners();
      expect(allPartners).toHaveLength(1);
      expect(allPartners[0].name).toBe('Test Partner');
    });
  });

  describe('getPartnersByTenant', () => {
    it('returns only partners for the specified tenant', () => {
      createPartner('tenant-1', {
        name: 'Partner A',
        email: 'a@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });
      createPartner('tenant-2', {
        name: 'Partner B',
        email: 'b@test.com',
        type: 'referral',
        status: 'active',
        commissionRate: 12,
      });

      const result = getPartnersByTenant('tenant-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Partner A');
    });
  });

  describe('getPartnerById', () => {
    it('returns the partner if it belongs to the tenant', () => {
      const partner = createPartner('tenant-1', {
        name: 'Partner X',
        email: 'x@test.com',
        type: 'distributor',
        status: 'active',
        commissionRate: 20,
      });

      const found = getPartnerById(partner.id, 'tenant-1');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Partner X');
    });

    it('returns undefined for wrong tenant', () => {
      const partner = createPartner('tenant-1', {
        name: 'Partner X',
        email: 'x@test.com',
        type: 'distributor',
        status: 'active',
        commissionRate: 20,
      });

      const found = getPartnerById(partner.id, 'tenant-2');
      expect(found).toBeUndefined();
    });
  });

  // ─── Deal Registration ──────────────────────────────────────

  describe('registerDeal', () => {
    it('creates a deal registration with pending status', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Enterprise License',
        contactName: 'John Doe',
        contactEmail: 'john@customer.com',
        expectedValue: 50000,
      });

      expect(reg.id).toBeDefined();
      expect(reg.partnerId).toBe(partner.id);
      expect(reg.tenantId).toBe('tenant-1');
      expect(reg.dealTitle).toBe('Enterprise License');
      expect(reg.contactName).toBe('John Doe');
      expect(reg.contactEmail).toBe('john@customer.com');
      expect(reg.expectedValue).toBe(50000);
      expect(reg.status).toBe('pending');
      expect(reg.expiresAt).toBeInstanceOf(Date);
    });

    it('normalizes contact email to lowercase', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal X',
        contactName: 'Jane',
        contactEmail: 'Jane@CORP.com',
        expectedValue: 10000,
      });

      expect(reg.contactEmail).toBe('jane@corp.com');
    });

    it('throws if partner not found', () => {
      expect(() =>
        registerDeal('non-existent', 'tenant-1', {
          dealTitle: 'X',
          contactName: 'Y',
          contactEmail: 'y@z.com',
          expectedValue: 1000,
        }),
      ).toThrow('Partner not found');
    });

    it('throws if partner is not active', () => {
      const partner = createPartner('tenant-1', {
        name: 'Inactive Partner',
        email: 'inactive@partner.com',
        type: 'reseller',
        status: 'inactive',
        commissionRate: 10,
      });

      expect(() =>
        registerDeal(partner.id, 'tenant-1', {
          dealTitle: 'X',
          contactName: 'Y',
          contactEmail: 'y@z.com',
          expectedValue: 1000,
        }),
      ).toThrow('Partner is not active');
    });

    it('uses custom expiry date when provided', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const customExpiry = new Date('2025-12-31');
      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Custom Expiry Deal',
        contactName: 'Bob',
        contactEmail: 'bob@corp.com',
        expectedValue: 25000,
        expiresAt: customExpiry,
      });

      expect(reg.expiresAt).toEqual(customExpiry);
    });
  });

  // ─── Approve / Reject ───────────────────────────────────────

  describe('approveDealRegistration', () => {
    it('approves a pending registration', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Big Deal',
        contactName: 'Alice',
        contactEmail: 'alice@company.com',
        expectedValue: 75000,
      });

      const approved = approveDealRegistration(reg.id, 'tenant-1', 'admin-user-1');
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe('admin-user-1');
    });

    it('throws if registration not found', () => {
      expect(() => approveDealRegistration('fake-id', 'tenant-1', 'admin')).toThrow(
        'Deal registration not found',
      );
    });

    it('throws if registration is not pending', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal',
        contactName: 'Alice',
        contactEmail: 'alice@test.com',
        expectedValue: 5000,
      });

      approveDealRegistration(reg.id, 'tenant-1', 'admin');
      expect(() => approveDealRegistration(reg.id, 'tenant-1', 'admin')).toThrow(
        'Cannot approve registration with status: approved',
      );
    });
  });

  describe('rejectDealRegistration', () => {
    it('rejects a pending registration with reason', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Overlap Deal',
        contactName: 'Bob',
        contactEmail: 'bob@company.com',
        expectedValue: 30000,
      });

      const rejected = rejectDealRegistration(reg.id, 'tenant-1', 'Duplicate contact');
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectedReason).toBe('Duplicate contact');
    });

    it('throws if registration not found', () => {
      expect(() => rejectDealRegistration('fake-id', 'tenant-1', 'reason')).toThrow(
        'Deal registration not found',
      );
    });

    it('throws if registration is not pending', () => {
      const partner = createPartner('tenant-1', {
        name: 'Test Partner',
        email: 'test@partner.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal',
        contactName: 'X',
        contactEmail: 'x@test.com',
        expectedValue: 2000,
      });

      rejectDealRegistration(reg.id, 'tenant-1', 'Bad lead');
      expect(() => rejectDealRegistration(reg.id, 'tenant-1', 'Again')).toThrow(
        'Cannot reject registration with status: rejected',
      );
    });
  });

  // ─── Conflict Detection ─────────────────────────────────────

  describe('checkConflict', () => {
    it('returns null when no conflict exists', () => {
      const result = checkConflict('tenant-1', 'unique@email.com');
      expect(result).toBeNull();
    });

    it('detects conflict with an active pending registration', () => {
      const partner = createPartner('tenant-1', {
        name: 'Partner A',
        email: 'a@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'First Claim',
        contactName: 'Target',
        contactEmail: 'target@company.com',
        expectedValue: 20000,
      });

      const conflict = checkConflict('tenant-1', 'target@company.com');
      expect(conflict).not.toBeNull();
      expect(conflict!.dealTitle).toBe('First Claim');
    });

    it('is case-insensitive for email comparison', () => {
      const partner = createPartner('tenant-1', {
        name: 'Partner A',
        email: 'a@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Claim',
        contactName: 'Target',
        contactEmail: 'CaseTest@Company.com',
        expectedValue: 5000,
      });

      const conflict = checkConflict('tenant-1', 'CASETEST@COMPANY.COM');
      expect(conflict).not.toBeNull();
    });

    it('ignores rejected registrations', () => {
      const partner = createPartner('tenant-1', {
        name: 'Partner A',
        email: 'a@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      const reg = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Rejected Claim',
        contactName: 'Target',
        contactEmail: 'rejected@company.com',
        expectedValue: 15000,
      });

      rejectDealRegistration(reg.id, 'tenant-1', 'Not a good fit');

      const conflict = checkConflict('tenant-1', 'rejected@company.com');
      expect(conflict).toBeNull();
    });
  });

  // ─── Commission Calculation ─────────────────────────────────

  describe('calculateCommission', () => {
    it('calculates percentage-based commission', () => {
      const result = calculateCommission(100000, 15, 'percentage');
      expect(result).toBe(15000);
    });

    it('calculates flat-rate commission', () => {
      const result = calculateCommission(100000, 2500, 'flat');
      expect(result).toBe(2500);
    });

    it('rounds to two decimal places', () => {
      const result = calculateCommission(33333, 7.5, 'percentage');
      expect(result).toBe(2499.98); // 33333 * 7.5 / 100 = 2499.975 -> 2499.98
    });

    it('defaults to percentage when no type specified', () => {
      const result = calculateCommission(50000, 10);
      expect(result).toBe(5000);
    });

    it('throws for negative deal amount', () => {
      expect(() => calculateCommission(-1000, 10, 'percentage')).toThrow(
        'Deal amount cannot be negative',
      );
    });

    it('throws for negative commission rate', () => {
      expect(() => calculateCommission(1000, -5, 'percentage')).toThrow(
        'Commission rate cannot be negative',
      );
    });

    it('handles zero deal amount', () => {
      const result = calculateCommission(0, 15, 'percentage');
      expect(result).toBe(0);
    });
  });

  // ─── Partner Dashboard ──────────────────────────────────────

  describe('getPartnerDashboard', () => {
    it('returns correct dashboard metrics', () => {
      const partner = createPartner('tenant-1', {
        name: 'Dashboard Partner',
        email: 'dashboard@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });

      // Register 3 deals
      const deal1 = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal 1',
        contactName: 'C1',
        contactEmail: 'c1@test.com',
        expectedValue: 50000,
      });
      const deal2 = registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal 2',
        contactName: 'C2',
        contactEmail: 'c2@test.com',
        expectedValue: 30000,
      });
      registerDeal(partner.id, 'tenant-1', {
        dealTitle: 'Deal 3',
        contactName: 'C3',
        contactEmail: 'c3@test.com',
        expectedValue: 20000,
      });

      // Approve deal1 and deal2
      approveDealRegistration(deal1.id, 'tenant-1', 'admin');
      approveDealRegistration(deal2.id, 'tenant-1', 'admin');

      const dashboard = getPartnerDashboard(partner.id, 'tenant-1');
      expect(dashboard.totalDeals).toBe(3);
      expect(dashboard.wonDeals).toBe(2);
      expect(dashboard.pipeline).toBe(20000); // Only pending deal
      expect(dashboard.commission).toBe(8000); // 10% of (50000 + 30000)
    });

    it('throws if partner not found', () => {
      expect(() => getPartnerDashboard('fake-id', 'tenant-1')).toThrow('Partner not found');
    });

    it('returns zeros for a partner with no deals', () => {
      const partner = createPartner('tenant-1', {
        name: 'New Partner',
        email: 'new@test.com',
        type: 'referral',
        status: 'active',
        commissionRate: 12,
      });

      const dashboard = getPartnerDashboard(partner.id, 'tenant-1');
      expect(dashboard.totalDeals).toBe(0);
      expect(dashboard.wonDeals).toBe(0);
      expect(dashboard.pipeline).toBe(0);
      expect(dashboard.commission).toBe(0);
    });
  });

  // ─── getPartnerDealRegistrations ────────────────────────────

  describe('getPartnerDealRegistrations', () => {
    it('returns only registrations for the specified partner', () => {
      const partnerA = createPartner('tenant-1', {
        name: 'Partner A',
        email: 'a@test.com',
        type: 'reseller',
        status: 'active',
        commissionRate: 10,
      });
      const partnerB = createPartner('tenant-1', {
        name: 'Partner B',
        email: 'b@test.com',
        type: 'referral',
        status: 'active',
        commissionRate: 8,
      });

      registerDeal(partnerA.id, 'tenant-1', {
        dealTitle: 'A Deal',
        contactName: 'Contact A',
        contactEmail: 'a@customer.com',
        expectedValue: 10000,
      });
      registerDeal(partnerB.id, 'tenant-1', {
        dealTitle: 'B Deal',
        contactName: 'Contact B',
        contactEmail: 'b@customer.com',
        expectedValue: 20000,
      });

      const result = getPartnerDealRegistrations(partnerA.id, 'tenant-1');
      expect(result).toHaveLength(1);
      expect(result[0].dealTitle).toBe('A Deal');
    });
  });
});
