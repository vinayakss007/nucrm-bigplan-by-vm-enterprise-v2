import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock drizzle DB
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 'assignment-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/territories', () => ({
  territories: {
    id: 'id',
    tenantId: 'tenant_id',
    name: 'name',
    parentId: 'parent_id',
    type: 'type',
    geoConfig: 'geo_config',
    assignedTo: 'assigned_to',
    deletedAt: 'deleted_at',
  },
  territoryAssignments: {
    id: 'id',
    tenantId: 'tenant_id',
    territoryId: 'territory_id',
    userId: 'user_id',
    role: 'role',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: unknown) => ['isNull', col]),
  sql: vi.fn(),
}));

describe('Territory Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assignTerritory', () => {
    it('assigns a user to a territory', async () => {
      const { assignTerritory } = await import('@/lib/territories');
      const result = await assignTerritory('user-1', 'territory-1', 'member');
      expect(result).toEqual({ id: 'assignment-1' });
    });

    it('assigns owner role and updates territory', async () => {
      const { assignTerritory } = await import('@/lib/territories');
      const result = await assignTerritory('user-2', 'territory-2', 'owner');
      expect(result).toEqual({ id: 'assignment-1' });
    });
  });

  describe('getTerritoryForLocation', () => {
    it('matches by city (most specific)', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'West Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
            { id: 't-2', name: 'California', type: 'state', geoConfig: { states: ['California'] }, assignedTo: 'u-b', parentId: 't-1' },
            { id: 't-3', name: 'San Francisco', type: 'city', geoConfig: { cities: ['San Francisco'] }, assignedTo: 'u-c', parentId: 't-2' },
          ]),
        })),
      });

      const { getTerritoryForLocation } = await import('@/lib/territories');
      const result = await getTerritoryForLocation('tenant-1', 'US', 'California', 'San Francisco');
      expect(result).toEqual({ id: 't-3', name: 'San Francisco', type: 'city', assignedTo: 'u-c' });
    });

    it('falls back to state when city not matched', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'West Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
            { id: 't-2', name: 'California', type: 'state', geoConfig: { states: ['California'] }, assignedTo: 'u-b', parentId: 't-1' },
          ]),
        })),
      });

      const { getTerritoryForLocation } = await import('@/lib/territories');
      const result = await getTerritoryForLocation('tenant-1', 'US', 'California', 'Los Angeles');
      expect(result).toEqual({ id: 't-2', name: 'California', type: 'state', assignedTo: 'u-b' });
    });

    it('falls back to country when state not matched', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'US Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
          ]),
        })),
      });

      const { getTerritoryForLocation } = await import('@/lib/territories');
      const result = await getTerritoryForLocation('tenant-1', 'US', 'Texas');
      expect(result).toEqual({ id: 't-1', name: 'US Region', type: 'region', assignedTo: 'u-a' });
    });

    it('returns null when no match found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

      const { getTerritoryForLocation } = await import('@/lib/territories');
      const result = await getTerritoryForLocation('tenant-1', 'Mars');
      expect(result).toBeNull();
    });
  });

  describe('getTerritoryTree', () => {
    it('builds hierarchical tree from flat list', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'US', type: 'region', parentId: null, geoConfig: { countries: ['US'] }, assignedTo: null },
            { id: 't-2', name: 'California', type: 'state', parentId: 't-1', geoConfig: { states: ['CA'] }, assignedTo: 'u-1' },
            { id: 't-3', name: 'SF', type: 'city', parentId: 't-2', geoConfig: { cities: ['SF'] }, assignedTo: 'u-2' },
          ]),
        })),
      });

      const { getTerritoryTree } = await import('@/lib/territories');
      const tree = await getTerritoryTree('tenant-1');
      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe('US');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.name).toBe('California');
      expect(tree[0]!.children[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.children[0]!.name).toBe('SF');
    });
  });

  describe('resolveOwner', () => {
    it('resolves territory owner via assignedTo field', async () => {
      const { db } = await import('@/drizzle/db');
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'US', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'owner-1', parentId: null },
          ]),
        })),
      });

      const { resolveOwner } = await import('@/lib/territories');
      const owner = await resolveOwner('tenant-1', { country: 'US' });
      expect(owner).toBe('owner-1');
    });
  });
});
