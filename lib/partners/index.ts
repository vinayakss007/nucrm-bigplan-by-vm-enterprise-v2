/**
 * Partner Portal - Deal Registration & Commission Tracking
 *
 * Manages partner relationships (resellers, referral partners, distributors),
 * deal registration workflows, conflict detection, and commission calculations.
 */

// ─── Types ──────────────────────────────────────────────────

export type PartnerType = 'reseller' | 'referral' | 'distributor';
export type PartnerStatus = 'active' | 'inactive' | 'suspended';
export type DealRegistrationStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type CommissionType = 'percentage' | 'flat';

export interface Partner {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  type: PartnerType;
  status: PartnerStatus;
  commissionRate: number;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DealRegistration {
  id: string;
  partnerId: string;
  tenantId: string;
  dealTitle: string;
  contactName: string;
  contactEmail: string;
  expectedValue: number;
  status: DealRegistrationStatus;
  expiresAt: Date;
  approvedBy?: string | null;
  rejectedReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DealRegistrationInput {
  dealTitle: string;
  contactName: string;
  contactEmail: string;
  expectedValue: number;
  expiresAt?: Date;
}

export interface PartnerDashboard {
  totalDeals: number;
  wonDeals: number;
  pipeline: number;
  commission: number;
}

// ─── In-memory store (production would use DB) ──────────────

let partners: Partner[] = [];
let dealRegistrations: DealRegistration[] = [];

/** Reset store - useful for testing */
export function _resetStore(): void {
  partners = [];
  dealRegistrations = [];
}

/** Seed partners - useful for testing */
export function _seedPartners(data: Partner[]): void {
  partners = [...data];
}

/** Seed deal registrations - useful for testing */
export function _seedDealRegistrations(data: DealRegistration[]): void {
  dealRegistrations = [...data];
}

/** Get all partners (read-only access for testing) */
export function _getPartners(): Partner[] {
  return partners;
}

/** Get all deal registrations (read-only access for testing) */
export function _getDealRegistrations(): DealRegistration[] {
  return dealRegistrations;
}

// ─── Partner Management ─────────────────────────────────────

export function createPartner(
  tenantId: string,
  data: Omit<Partner, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
): Partner {
  const partner: Partner = {
    id: crypto.randomUUID(),
    tenantId,
    name: data.name,
    email: data.email,
    type: data.type,
    status: data.status,
    commissionRate: data.commissionRate,
    metadata: data.metadata ?? {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  partners.push(partner);
  return partner;
}

export function getPartnersByTenant(tenantId: string): Partner[] {
  return partners.filter((p) => p.tenantId === tenantId);
}

export function getPartnerById(partnerId: string, tenantId: string): Partner | undefined {
  return partners.find((p) => p.id === partnerId && p.tenantId === tenantId);
}

// ─── Deal Registration ──────────────────────────────────────

/**
 * Submit a new deal registration for a partner.
 * Default expiration is 90 days from now if not specified.
 */
export function registerDeal(
  partnerId: string,
  tenantId: string,
  dealData: DealRegistrationInput,
): DealRegistration {
  const partner = getPartnerById(partnerId, tenantId);
  if (!partner) {
    throw new Error('Partner not found');
  }
  if (partner.status !== 'active') {
    throw new Error('Partner is not active');
  }

  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 90);

  const registration: DealRegistration = {
    id: crypto.randomUUID(),
    partnerId,
    tenantId,
    dealTitle: dealData.dealTitle,
    contactName: dealData.contactName,
    contactEmail: dealData.contactEmail.toLowerCase(),
    expectedValue: dealData.expectedValue,
    status: 'pending',
    expiresAt: dealData.expiresAt ?? defaultExpiry,
    approvedBy: null,
    rejectedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  dealRegistrations.push(registration);
  return registration;
}

/**
 * Approve a deal registration.
 */
export function approveDealRegistration(
  registrationId: string,
  tenantId: string,
  approverId: string,
): DealRegistration {
  const reg = dealRegistrations.find(
    (r) => r.id === registrationId && r.tenantId === tenantId,
  );
  if (!reg) {
    throw new Error('Deal registration not found');
  }
  if (reg.status !== 'pending') {
    throw new Error(`Cannot approve registration with status: ${reg.status}`);
  }

  reg.status = 'approved';
  reg.approvedBy = approverId;
  reg.updatedAt = new Date();
  return reg;
}

/**
 * Reject a deal registration with a reason.
 */
export function rejectDealRegistration(
  registrationId: string,
  tenantId: string,
  reason: string,
): DealRegistration {
  const reg = dealRegistrations.find(
    (r) => r.id === registrationId && r.tenantId === tenantId,
  );
  if (!reg) {
    throw new Error('Deal registration not found');
  }
  if (reg.status !== 'pending') {
    throw new Error(`Cannot reject registration with status: ${reg.status}`);
  }

  reg.status = 'rejected';
  reg.rejectedReason = reason;
  reg.updatedAt = new Date();
  return reg;
}

/**
 * Check if a deal is already registered by another partner for the same contact email.
 * Returns the conflicting registration if found, or null if no conflict.
 */
export function checkConflict(
  tenantId: string,
  contactEmail: string,
): DealRegistration | null {
  const normalizedEmail = contactEmail.toLowerCase();
  const conflict = dealRegistrations.find(
    (r) =>
      r.tenantId === tenantId &&
      r.contactEmail === normalizedEmail &&
      (r.status === 'pending' || r.status === 'approved') &&
      new Date(r.expiresAt) > new Date(),
  );
  return conflict ?? null;
}

// ─── Commission Calculation ─────────────────────────────────

/**
 * Calculate commission payout for a deal.
 *
 * @param dealAmount - The total deal value
 * @param commissionRate - The rate (percentage as 0-100, or flat amount)
 * @param commissionType - 'percentage' or 'flat'
 * @returns The computed commission amount (rounded to 2 decimal places)
 */
export function calculateCommission(
  dealAmount: number,
  commissionRate: number,
  commissionType: CommissionType = 'percentage',
): number {
  if (dealAmount < 0) {
    throw new Error('Deal amount cannot be negative');
  }
  if (commissionRate < 0) {
    throw new Error('Commission rate cannot be negative');
  }

  if (commissionType === 'flat') {
    return Math.round(commissionRate * 100) / 100;
  }

  // Percentage-based: rate is 0-100
  const commission = (dealAmount * commissionRate) / 100;
  return Math.round(commission * 100) / 100;
}

// ─── Partner Dashboard ──────────────────────────────────────

/**
 * Get partner dashboard metrics.
 * Returns aggregate data about the partner's deal registrations.
 */
export function getPartnerDashboard(
  partnerId: string,
  tenantId: string,
): PartnerDashboard {
  const partner = getPartnerById(partnerId, tenantId);
  if (!partner) {
    throw new Error('Partner not found');
  }

  const partnerDeals = dealRegistrations.filter(
    (r) => r.partnerId === partnerId && r.tenantId === tenantId,
  );

  const totalDeals = partnerDeals.length;
  const wonDeals = partnerDeals.filter((r) => r.status === 'approved').length;
  const pipeline = partnerDeals
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.expectedValue, 0);

  const commission = partnerDeals
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => {
      return sum + calculateCommission(r.expectedValue, partner.commissionRate, 'percentage');
    }, 0);

  return { totalDeals, wonDeals, pipeline, commission };
}

/**
 * Get deal registrations for a partner.
 */
export function getPartnerDealRegistrations(
  partnerId: string,
  tenantId: string,
): DealRegistration[] {
  return dealRegistrations.filter(
    (r) => r.partnerId === partnerId && r.tenantId === tenantId,
  );
}
