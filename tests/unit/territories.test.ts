import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/drizzle/schema/territories', () => ({
  territories: {
    id: 'id', tenantId: 'tenant_id', name: 'name',
    parentId: 'parent_id', type: 'type', geoConfig: 'geo_config',
    assignedTo: 'assigned_to', deletedAt: 'deleted_at',
  },
  territoryAssignments: {
    id: 'id', tenantId: 'tenant_id', territoryId: 'territory_id',
    userId: 'user_id', role: 'role',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ['eq', ...args]),
  and: vi.fn((...args: unknown[]) => ['and', ...args]),
  isNull: vi.fn((col: unknown) => ['isNull', col]),
  sql: vi.fn(),
}));

import { db } from '@/drizzle/db';

function mockSelect(returnValue: any) {
  (db.select as any).mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => returnValue),
    })),
  });
}

function mockInsert(returnValue: any) {
  (db.insert as any).mockReturnValue({
    values: vi.fn(() => ({
      returning: vi.fn(() => [returnValue]),
    })),
  });
}

function mockUpdate(returnValue: any) {
  (db.update as any).mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => returnValue),
    })),
  });
}

describe('assignTerritory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns a user as member', async () => {
    mockInsert({ id: 'assignment-1' });

    const { assignTerritory } = await import('@/lib/territories');
    const result = await assignTerritory('user-1', 'territory-1', 'member');

    expect(result).toEqual({ id: 'assignment-1' });
  });

  it('assigns a user as owner and updates territory', async () => {
    mockInsert({ id: 'assignment-2' });
    mockUpdate([]);

    const { assignTerritory } = await import('@/lib/territories');
    const result = await assignTerritory('user-2', 'territory-2', 'owner');

    expect(result).toEqual({ id: 'assignment-2' });
    expect(db.update).toHaveBeenCalled();
  });

  it('defaults to member role', async () => {
    mockInsert({ id: 'assignment-3' });

    const { assignTerritory } = await import('@/lib/territories');
    const result = await assignTerritory('user-3', 'territory-3');

    expect(result).toEqual({ id: 'assignment-3' });
  });
});

describe('getTerritoryForLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches by city (most specific)', async () => {
    mockSelect([
      { id: 't-1', name: 'West Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
      { id: 't-2', name: 'California', type: 'state', geoConfig: { states: ['California'] }, assignedTo: 'u-b', parentId: 't-1' },
      { id: 't-3', name: 'San Francisco', type: 'city', geoConfig: { cities: ['San Francisco'] }, assignedTo: 'u-c', parentId: 't-2' },
    ]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', 'US', 'California', 'San Francisco');

    expect(result).toEqual({ id: 't-3', name: 'San Francisco', type: 'city', assignedTo: 'u-c' });
  });

  it('falls back to state when city not matched', async () => {
    mockSelect([
      { id: 't-1', name: 'West Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
      { id: 't-2', name: 'California', type: 'state', geoConfig: { states: ['California'] }, assignedTo: 'u-b', parentId: 't-1' },
    ]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', 'US', 'California', 'Los Angeles');

    expect(result).toEqual({ id: 't-2', name: 'California', type: 'state', assignedTo: 'u-b' });
  });

  it('falls back to country when state not matched', async () => {
    mockSelect([
      { id: 't-1', name: 'US Region', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'u-a', parentId: null },
    ]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', 'US', 'Texas');

    expect(result).toEqual({ id: 't-1', name: 'US Region', type: 'region', assignedTo: 'u-a' });
  });

  it('returns null when no match found at any level', async () => {
    mockSelect([]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', 'Mars');

    expect(result).toBeNull();
  });

  it('returns null for empty tenant with no territories', async () => {
    mockSelect([]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-empty', 'US', 'California', 'SF');

    expect(result).toBeNull();
  });

  it('handles case-insensitive city matching', async () => {
    mockSelect([
      { id: 't-1', name: 'SF', type: 'city', geoConfig: { cities: ['san francisco'] }, assignedTo: 'u-1', parentId: null },
    ]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', undefined, undefined, 'SAN FRANCISCO');

    expect(result).toEqual({ id: 't-1', name: 'SF', type: 'city', assignedTo: 'u-1' });
  });

  it('handles territory with no geoConfig', async () => {
    mockSelect([
      { id: 't-1', name: 'Empty', type: 'region', geoConfig: null, assignedTo: null, parentId: null },
    ]);

    const { getTerritoryForLocation } = await import('@/lib/territories');
    const result = await getTerritoryForLocation('tenant-1', 'US');

    expect(result).toBeNull();
  });
});

describe('getTerritoryTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds hierarchical tree from flat list', async () => {
    mockSelect([
      { id: 't-1', name: 'US', type: 'region', parentId: null, geoConfig: { countries: ['US'] }, assignedTo: null },
      { id: 't-2', name: 'California', type: 'state', parentId: 't-1', geoConfig: { states: ['CA'] }, assignedTo: 'u-1' },
      { id: 't-3', name: 'SF', type: 'city', parentId: 't-2', geoConfig: { cities: ['SF'] }, assignedTo: 'u-2' },
    ]);

    const { getTerritoryTree } = await import('@/lib/territories');
    const tree = await getTerritoryTree('tenant-1');

    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe('US');
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.name).toBe('California');
    expect(tree[0]!.children[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.children[0]!.name).toBe('SF');
  });

  it('returns multiple root nodes', async () => {
    mockSelect([
      { id: 't-1', name: 'US', type: 'region', parentId: null, geoConfig: {}, assignedTo: null },
      { id: 't-2', name: 'EU', type: 'region', parentId: null, geoConfig: {}, assignedTo: null },
    ]);

    const { getTerritoryTree } = await import('@/lib/territories');
    const tree = await getTerritoryTree('tenant-1');

    expect(tree).toHaveLength(2);
  });

  it('returns empty array when no territories', async () => {
    mockSelect([]);

    const { getTerritoryTree } = await import('@/lib/territories');
    const tree = await getTerritoryTree('tenant-empty');

    expect(tree).toEqual([]);
  });
});

describe('resolveOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves territory owner via assignedTo field', async () => {
    mockSelect([
      { id: 't-1', name: 'US', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: 'owner-1', parentId: null },
    ]);

    const { resolveOwner } = await import('@/lib/territories');
    const owner = await resolveOwner('tenant-1', { country: 'US' });

    expect(owner).toBe('owner-1');
  });

  it('returns null when no territory matches', async () => {
    mockSelect([]);

    const { resolveOwner } = await import('@/lib/territories');
    const owner = await resolveOwner('tenant-1', { country: 'Mars' });

    expect(owner).toBeNull();
  });

  it('looks up owner from assignments table when no direct assignedTo', async () => {
    const { db } = await import('@/drizzle/db');
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'US', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: null, parentId: null },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { userId: 'assignment-owner-1', role: 'owner' },
          ]),
        })),
      });

    const { resolveOwner } = await import('@/lib/territories');
    const owner = await resolveOwner('tenant-1', { country: 'US' });

    expect(owner).toBe('assignment-owner-1');
  });

  it('returns null when no owner assignment found', async () => {
    const { db } = await import('@/drizzle/db');
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => [
            { id: 't-1', name: 'US', type: 'region', geoConfig: { countries: ['US'] }, assignedTo: null, parentId: null },
          ]),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      });

    const { resolveOwner } = await import('@/lib/territories');
    const owner = await resolveOwner('tenant-1', { country: 'US' });

    expect(owner).toBeNull();
  });
});
