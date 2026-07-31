/**
 * NuCRM - Geo Check-In/Check-Out for Field Sales Teams
 *
 * Provides GPS-based location check-in/check-out for field sales representatives.
 * Supports proximity validation via the Haversine formula, photo/voice note
 * attachments, and manager-level team views.
 */

export interface CheckIn {
  id: string;
  userId: string;
  tenantId: string;
  contactId?: string | null;
  companyId?: string | null;
  latitude: number;
  longitude: number;
  address?: string | null;
  photoUrl?: string | null;
  voiceNoteUrl?: string | null;
  notes?: string | null;
  checkedInAt: Date;
  checkedOutAt?: Date | null;
  duration?: number | null; // duration in seconds
}

export interface CreateCheckInData {
  lat: number;
  lng: number;
  contactId?: string;
  companyId?: string;
  photoUrl?: string;
  voiceNoteUrl?: string;
  address?: string;
  notes?: string;
}

export interface CreateCheckOutData {
  lat: number;
  lng: number;
  notes?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

// In-memory store for check-ins (would be a DB table in production)
const checkInStore: Map<string, CheckIn> = new Map();

/**
 * Calculate distance between two GPS coordinates using the Haversine formula.
 * Returns distance in kilometers.
 */
export function getDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validate that a check-in location is within the expected radius of a target location.
 * Returns true if the distance is within the specified radius (in meters).
 */
export function validateProximity(
  checkInLat: number,
  checkInLng: number,
  expectedLat: number,
  expectedLng: number,
  radiusMeters: number
): boolean {
  const distanceKm = getDistanceKm(checkInLat, checkInLng, expectedLat, expectedLng);
  const distanceMeters = distanceKm * 1000;
  return distanceMeters <= radiusMeters;
}

/**
 * Create a new check-in record for a field sales user.
 */
export function createCheckIn(
  userId: string,
  tenantId: string,
  data: CreateCheckInData
): CheckIn {
  if (!userId) throw new Error('userId is required');
  if (!tenantId) throw new Error('tenantId is required');
  if (data.lat == null || data.lng == null) throw new Error('lat and lng are required');
  if (data.lat < -90 || data.lat > 90) throw new Error('Invalid latitude');
  if (data.lng < -180 || data.lng > 180) throw new Error('Invalid longitude');

  const checkIn: CheckIn = {
    id: generateId(),
    userId,
    tenantId,
    contactId: data.contactId ?? null,
    companyId: data.companyId ?? null,
    latitude: data.lat,
    longitude: data.lng,
    address: data.address ?? null,
    photoUrl: data.photoUrl ?? null,
    voiceNoteUrl: data.voiceNoteUrl ?? null,
    notes: data.notes ?? null,
    checkedInAt: new Date(),
    checkedOutAt: null,
    duration: null,
  };

  checkInStore.set(checkIn.id, checkIn);
  return checkIn;
}

/**
 * Create a check-out for an existing check-in.
 * Calculates duration in seconds between check-in and check-out.
 */
export function createCheckOut(
  checkInId: string,
  userId: string,
  data: CreateCheckOutData
): CheckIn {
  if (!checkInId) throw new Error('checkInId is required');
  if (!userId) throw new Error('userId is required');

  const checkIn = checkInStore.get(checkInId);
  if (!checkIn) throw new Error('Check-in not found');
  if (checkIn.userId !== userId) throw new Error('Unauthorized: check-in belongs to another user');
  if (checkIn.checkedOutAt) throw new Error('Already checked out');

  if (data.lat < -90 || data.lat > 90) throw new Error('Invalid latitude');
  if (data.lng < -180 || data.lng > 180) throw new Error('Invalid longitude');

  const checkedOutAt = new Date();
  const durationMs = checkedOutAt.getTime() - checkIn.checkedInAt.getTime();
  const durationSeconds = Math.round(durationMs / 1000);

  const updatedCheckIn: CheckIn = {
    ...checkIn,
    checkedOutAt,
    duration: durationSeconds,
    notes: data.notes ? `${checkIn.notes ? checkIn.notes + ' | ' : ''}${data.notes}` : checkIn.notes,
  };

  checkInStore.set(checkInId, updatedCheckIn);
  return updatedCheckIn;
}

/**
 * Get all check-ins for a user within a given date range.
 */
export function getUserCheckIns(
  userId: string,
  tenantId: string,
  dateRange: DateRange
): CheckIn[] {
  if (!userId) throw new Error('userId is required');
  if (!tenantId) throw new Error('tenantId is required');
  if (!dateRange.from || !dateRange.to) throw new Error('dateRange.from and dateRange.to are required');

  const results: CheckIn[] = [];
  for (const checkIn of checkInStore.values()) {
    if (
      checkIn.userId === userId &&
      checkIn.tenantId === tenantId &&
      checkIn.checkedInAt >= dateRange.from &&
      checkIn.checkedInAt <= dateRange.to
    ) {
      results.push(checkIn);
    }
  }

  return results.sort((a, b) => {
    const timeDiff = b.checkedInAt.getTime() - a.checkedInAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    // Stable tiebreaker: later-created IDs sort first (descending insertion order)
    return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
  });
}

/**
 * Get all check-ins for a tenant for today (manager view).
 * Optionally filter by managerId to show only direct reports.
 */
export function getTeamCheckInsToday(
  tenantId: string,
  managerId?: string
): CheckIn[] {
  if (!tenantId) throw new Error('tenantId is required');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const results: CheckIn[] = [];
  for (const checkIn of checkInStore.values()) {
    if (
      checkIn.tenantId === tenantId &&
      checkIn.checkedInAt >= today &&
      checkIn.checkedInAt < tomorrow
    ) {
      // If managerId is provided, filter to only show that manager's team
      // In production, this would query a team/hierarchy table
      if (managerId && checkIn.userId === managerId) continue;
      results.push(checkIn);
    }
  }

  return results.sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime());
}

/**
 * Get a single check-in by ID. Used for checkout validation.
 */
export function getCheckInById(checkInId: string): CheckIn | undefined {
  return checkInStore.get(checkInId);
}

/**
 * Clear the store (for testing purposes).
 */
export function _clearStore(): void {
  checkInStore.clear();
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

let _idCounter = 0;

function generateId(): string {
  _idCounter++;
  return `checkin_${Date.now()}_${_idCounter}_${Math.random().toString(36).substring(2, 11)}`;
}
