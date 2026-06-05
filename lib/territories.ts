/**
 * Territory Management Engine
 * 
 * Handles hierarchical territory assignment and location-based routing.
 * Supports region > country > state > city hierarchy.
 */
import { db } from '@/drizzle/db';
import { territories, territoryAssignments } from '@/drizzle/schema/territories';
import { eq, and, isNull } from 'drizzle-orm';

export interface GeoConfig {
  countries?: string[];
  states?: string[];
  cities?: string[];
  postalCodes?: string[];
}

export interface TerritoryNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  geoConfig: GeoConfig;
  assignedTo: string | null;
  children: TerritoryNode[];
}

/**
 * Assign a user to a territory with a specific role
 */
export async function assignTerritory(
  userId: string,
  territoryId: string,
  role: 'owner' | 'member' = 'member'
): Promise<{ id: string }> {
  const [assignment] = await db
    .insert(territoryAssignments)
    .values({
      userId,
      territoryId,
      role,
      tenantId: '', // caller should set via context
    })
    .returning({ id: territoryAssignments.id });

  // If role is owner, also update the territory shortcut
  if (role === 'owner') {
    await db
      .update(territories)
      .set({ assignedTo: userId })
      .where(eq(territories.id, territoryId));
  }

  return assignment!;
}

/**
 * Find a territory that matches a given location (country, state, city).
 * Matches from most specific (city) to least specific (region).
 */
export async function getTerritoryForLocation(
  tenantId: string,
  country?: string,
  state?: string,
  city?: string
): Promise<{ id: string; name: string; type: string; assignedTo: string | null } | null> {
  const allTerritories = await db
    .select()
    .from(territories)
    .where(and(eq(territories.tenantId, tenantId), isNull(territories.deletedAt)));

  // Try city match first (most specific)
  if (city) {
    const cityMatch = allTerritories.find((t) => {
      const geo = (t.geoConfig as GeoConfig) || {};
      return geo.cities?.some((c) => c.toLowerCase() === city.toLowerCase());
    });
    if (cityMatch) return { id: cityMatch.id, name: cityMatch.name, type: cityMatch.type, assignedTo: cityMatch.assignedTo };
  }

  // Try state match
  if (state) {
    const stateMatch = allTerritories.find((t) => {
      const geo = (t.geoConfig as GeoConfig) || {};
      return geo.states?.some((s) => s.toLowerCase() === state.toLowerCase());
    });
    if (stateMatch) return { id: stateMatch.id, name: stateMatch.name, type: stateMatch.type, assignedTo: stateMatch.assignedTo };
  }

  // Try country match (least specific)
  if (country) {
    const countryMatch = allTerritories.find((t) => {
      const geo = (t.geoConfig as GeoConfig) || {};
      return geo.countries?.some((c) => c.toLowerCase() === country.toLowerCase());
    });
    if (countryMatch) return { id: countryMatch.id, name: countryMatch.name, type: countryMatch.type, assignedTo: countryMatch.assignedTo };
  }

  return null;
}

/**
 * Resolve the owner of a territory for a given location.
 * Returns the userId of the territory owner, or null if no match.
 */
export async function resolveOwner(
  tenantId: string,
  location: { country?: string; state?: string; city?: string }
): Promise<string | null> {
  const territory = await getTerritoryForLocation(tenantId, location.country, location.state, location.city);
  if (!territory) return null;

  // Check explicit assignment first
  if (territory.assignedTo) return territory.assignedTo;

  // Look up owner in assignments table
  const assignments = await db
    .select()
    .from(territoryAssignments)
    .where(
      and(
        eq(territoryAssignments.territoryId, territory.id),
        eq(territoryAssignments.role, 'owner')
      )
    );

  if (assignments.length > 0) {
    return assignments[0]!.userId;
  }

  return null;
}

/**
 * Build hierarchical territory tree for a tenant
 */
export async function getTerritoryTree(tenantId: string): Promise<TerritoryNode[]> {
  const allTerritories = await db
    .select()
    .from(territories)
    .where(and(eq(territories.tenantId, tenantId), isNull(territories.deletedAt)));

  // Build tree from flat list
  const nodeMap = new Map<string, TerritoryNode>();
  const roots: TerritoryNode[] = [];

  // Create nodes
  for (const t of allTerritories) {
    nodeMap.set(t.id, {
      id: t.id,
      name: t.name,
      type: t.type,
      parentId: t.parentId,
      geoConfig: (t.geoConfig as GeoConfig) || {},
      assignedTo: t.assignedTo,
      children: [],
    });
  }

  // Link children to parents
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
