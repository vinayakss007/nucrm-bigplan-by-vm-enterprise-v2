import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDistanceKm,
  validateProximity,
  createCheckIn,
  createCheckOut,
  getUserCheckIns,
  getTeamCheckInsToday,
  _clearStore,
} from '@/lib/field-sales/geo-checkin';

describe('Geo Check-In/Check-Out', () => {
  beforeEach(() => {
    _clearStore();
  });

  // ===========================================================================
  // Haversine Distance Calculation
  // ===========================================================================
  describe('getDistanceKm (Haversine)', () => {
    it('returns 0 for the same coordinates', () => {
      const dist = getDistanceKm(40.7128, -74.006, 40.7128, -74.006);
      expect(dist).toBe(0);
    });

    it('calculates distance between New York and Los Angeles correctly', () => {
      // NY: 40.7128, -74.0060 | LA: 34.0522, -118.2437
      const dist = getDistanceKm(40.7128, -74.006, 34.0522, -118.2437);
      // Expected ~3940 km
      expect(dist).toBeGreaterThan(3900);
      expect(dist).toBeLessThan(4000);
    });

    it('calculates short distances accurately', () => {
      // Two points roughly 1 km apart in Manhattan
      const dist = getDistanceKm(40.748817, -73.985428, 40.7579, -73.9855);
      expect(dist).toBeGreaterThan(0.9);
      expect(dist).toBeLessThan(1.2);
    });

    it('handles coordinates at the equator', () => {
      // Two points 1 degree of longitude apart at equator (~111 km)
      const dist = getDistanceKm(0, 0, 0, 1);
      expect(dist).toBeGreaterThan(110);
      expect(dist).toBeLessThan(112);
    });

    it('handles antipodal points', () => {
      // North Pole to South Pole
      const dist = getDistanceKm(90, 0, -90, 0);
      // Should be approximately half the circumference: ~20015 km
      expect(dist).toBeGreaterThan(20000);
      expect(dist).toBeLessThan(20100);
    });
  });

  // ===========================================================================
  // Proximity Validation
  // ===========================================================================
  describe('validateProximity', () => {
    it('returns true when within the radius', () => {
      // Same location with 100m radius
      const result = validateProximity(40.7128, -74.006, 40.7128, -74.006, 100);
      expect(result).toBe(true);
    });

    it('returns false when outside the radius', () => {
      // NY to LA with 1000m radius
      const result = validateProximity(40.7128, -74.006, 34.0522, -118.2437, 1000);
      expect(result).toBe(false);
    });

    it('returns true when exactly at the boundary', () => {
      // Two points ~111m apart (0.001 degrees latitude at equator)
      const dist = getDistanceKm(0, 0, 0.001, 0) * 1000; // in meters
      const result = validateProximity(0, 0, 0.001, 0, Math.ceil(dist));
      expect(result).toBe(true);
    });

    it('validates a rep within 200m of a customer site', () => {
      // Customer at 40.7580, -73.9855; rep 50m away
      const result = validateProximity(40.7580, -73.9855, 40.75845, -73.9855, 200);
      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // Check-In CRUD
  // ===========================================================================
  describe('createCheckIn', () => {
    it('creates a check-in with required fields', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
      });

      expect(checkIn.id).toBeTruthy();
      expect(checkIn.userId).toBe('user-1');
      expect(checkIn.tenantId).toBe('tenant-1');
      expect(checkIn.latitude).toBe(40.7128);
      expect(checkIn.longitude).toBe(-74.006);
      expect(checkIn.checkedInAt).toBeInstanceOf(Date);
      expect(checkIn.checkedOutAt).toBeNull();
      expect(checkIn.duration).toBeNull();
    });

    it('creates a check-in with optional fields', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
        contactId: 'contact-123',
        companyId: 'company-456',
        photoUrl: 'https://example.com/photo.jpg',
        notes: 'Met with client at office',
      });

      expect(checkIn.contactId).toBe('contact-123');
      expect(checkIn.companyId).toBe('company-456');
      expect(checkIn.photoUrl).toBe('https://example.com/photo.jpg');
      expect(checkIn.notes).toBe('Met with client at office');
    });

    it('throws on invalid latitude', () => {
      expect(() => createCheckIn('user-1', 'tenant-1', { lat: 91, lng: 0 }))
        .toThrow('Invalid latitude');
      expect(() => createCheckIn('user-1', 'tenant-1', { lat: -91, lng: 0 }))
        .toThrow('Invalid latitude');
    });

    it('throws on invalid longitude', () => {
      expect(() => createCheckIn('user-1', 'tenant-1', { lat: 0, lng: 181 }))
        .toThrow('Invalid longitude');
      expect(() => createCheckIn('user-1', 'tenant-1', { lat: 0, lng: -181 }))
        .toThrow('Invalid longitude');
    });

    it('throws when userId is missing', () => {
      expect(() => createCheckIn('', 'tenant-1', { lat: 0, lng: 0 }))
        .toThrow('userId is required');
    });

    it('throws when tenantId is missing', () => {
      expect(() => createCheckIn('user-1', '', { lat: 0, lng: 0 }))
        .toThrow('tenantId is required');
    });
  });

  // ===========================================================================
  // Check-Out & Duration Calculation
  // ===========================================================================
  describe('createCheckOut', () => {
    it('creates a check-out and calculates duration', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
      });

      // Small delay to ensure duration > 0
      const checkOut = createCheckOut(checkIn.id, 'user-1', {
        lat: 40.7130,
        lng: -74.005,
      });

      expect(checkOut.checkedOutAt).toBeInstanceOf(Date);
      expect(checkOut.duration).toBeGreaterThanOrEqual(0);
      expect(checkOut.checkedOutAt!.getTime()).toBeGreaterThanOrEqual(
        checkOut.checkedInAt.getTime()
      );
    });

    it('throws when check-in is not found', () => {
      expect(() => createCheckOut('nonexistent', 'user-1', { lat: 0, lng: 0 }))
        .toThrow('Check-in not found');
    });

    it('throws when user does not own the check-in', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
      });

      expect(() => createCheckOut(checkIn.id, 'user-2', { lat: 0, lng: 0 }))
        .toThrow('Unauthorized: check-in belongs to another user');
    });

    it('throws when already checked out', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
      });

      createCheckOut(checkIn.id, 'user-1', { lat: 0, lng: 0 });

      expect(() => createCheckOut(checkIn.id, 'user-1', { lat: 0, lng: 0 }))
        .toThrow('Already checked out');
    });

    it('appends checkout notes to existing notes', () => {
      const checkIn = createCheckIn('user-1', 'tenant-1', {
        lat: 40.7128,
        lng: -74.006,
        notes: 'Arrived at client office',
      });

      const checkOut = createCheckOut(checkIn.id, 'user-1', {
        lat: 40.7130,
        lng: -74.005,
        notes: 'Meeting completed successfully',
      });

      expect(checkOut.notes).toBe('Arrived at client office | Meeting completed successfully');
    });
  });

  // ===========================================================================
  // getUserCheckIns
  // ===========================================================================
  describe('getUserCheckIns', () => {
    it('returns check-ins within the date range', () => {
      createCheckIn('user-1', 'tenant-1', { lat: 10, lng: 20 });
      createCheckIn('user-1', 'tenant-1', { lat: 11, lng: 21 });
      createCheckIn('user-2', 'tenant-1', { lat: 12, lng: 22 });

      const now = new Date();
      const from = new Date(now.getTime() - 60000); // 1 min ago
      const to = new Date(now.getTime() + 60000); // 1 min from now

      const results = getUserCheckIns('user-1', 'tenant-1', { from, to });
      expect(results).toHaveLength(2);
      expect(results[0]!.userId).toBe('user-1');
    });

    it('returns empty array when no check-ins in range', () => {
      createCheckIn('user-1', 'tenant-1', { lat: 10, lng: 20 });

      const pastFrom = new Date('2020-01-01');
      const pastTo = new Date('2020-01-02');

      const results = getUserCheckIns('user-1', 'tenant-1', { from: pastFrom, to: pastTo });
      expect(results).toHaveLength(0);
    });

    it('orders results by checkedInAt descending', () => {
      const first = createCheckIn('user-1', 'tenant-1', { lat: 10, lng: 20 });
      const second = createCheckIn('user-1', 'tenant-1', { lat: 11, lng: 21 });

      const now = new Date();
      const results = getUserCheckIns('user-1', 'tenant-1', {
        from: new Date(now.getTime() - 60000),
        to: new Date(now.getTime() + 60000),
      });

      // Most recent first
      expect(results[0]!.id).toBe(second.id);
      expect(results[1]!.id).toBe(first.id);
    });
  });

  // ===========================================================================
  // getTeamCheckInsToday
  // ===========================================================================
  describe('getTeamCheckInsToday', () => {
    it('returns all check-ins for the tenant today', () => {
      createCheckIn('user-1', 'tenant-1', { lat: 10, lng: 20 });
      createCheckIn('user-2', 'tenant-1', { lat: 11, lng: 21 });
      createCheckIn('user-3', 'tenant-2', { lat: 12, lng: 22 });

      const results = getTeamCheckInsToday('tenant-1');
      expect(results).toHaveLength(2);
    });

    it('excludes check-ins from other tenants', () => {
      createCheckIn('user-1', 'tenant-1', { lat: 10, lng: 20 });
      createCheckIn('user-2', 'tenant-2', { lat: 11, lng: 21 });

      const results = getTeamCheckInsToday('tenant-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.tenantId).toBe('tenant-1');
    });

    it('throws when tenantId is missing', () => {
      expect(() => getTeamCheckInsToday('')).toThrow('tenantId is required');
    });
  });
});
