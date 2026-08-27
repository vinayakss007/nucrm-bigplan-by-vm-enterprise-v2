/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Auto-Assignment Engine
 *
 * Provides multiple strategies for automatically assigning leads, tickets,
 * and other entities to team members:
 * - Round Robin: Rotate through team members sequentially
 * - Territory Based: Match entity location to territory owner
 * - Skill Based: Match entity tags/category to agent skills
 * - Weighted Random: Distribute by configured weights
 */

export interface TeamMember {
  userId: string;
  name?: string;
  skills?: string[];
  territories?: string[];
  weight?: number;
  isAvailable?: boolean;
}

export interface AssignmentResult {
  assignedTo: string;
  reason: string;
  strategy: 'round_robin' | 'territory' | 'skill_based' | 'weighted';
}

export interface RoundRobinState {
  /**
   * The userId of the member assigned on the previous run. The cursor is
   * anchored to member identity rather than a position in the filtered
   * `available` list, because that list changes as availability/roster changes
   * and an index would then map to a different member on the next call,
   * producing uneven rotation. Null/undefined means "no prior assignment".
   */
  lastAssignedUserId?: string | null;
}

export interface TerritoryConfig {
  members: TeamMember[];
  entityLocation: string;
}

export interface SkillConfig {
  members: TeamMember[];
  requiredSkills: string[];
  matchMode?: 'any' | 'all';
}

export interface WeightedConfig {
  members: TeamMember[];
}

/**
 * Round Robin assignment - rotates through team members in order.
 * Skips unavailable members.
 *
 * The cursor is anchored to the last-assigned member's userId, not a position
 * in the (volatile) filtered available list. Each call builds a STABLE ordering
 * of the full roster (sorted by userId), finds where the last-assigned userId
 * sits in that order, and picks the next AVAILABLE member after it (wrapping
 * around). If the last-assigned userId is no longer present, it starts from the
 * first available member in stable order. This keeps rotation stable even as
 * availability or the roster changes between calls.
 */
export function roundRobin(
  members: TeamMember[],
  state: RoundRobinState
): AssignmentResult {
  if (members.length === 0) {
    throw new Error('No team members available for assignment');
  }

  // Stable ordering of the full roster so the rotation order does not depend on
  // the incoming array order or on which members are currently available.
  const ordered = [...members].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  const available = ordered.filter(m => m.isAvailable !== false);
  if (available.length === 0) {
    throw new Error('No available team members for assignment');
  }

  // Find the last-assigned member's position in the stable full-roster order.
  // If it is absent (roster changed) we treat it as "before the start" so we
  // pick the first available member.
  const lastId = state.lastAssignedUserId ?? null;
  const lastPos = lastId == null ? -1 : ordered.findIndex(m => m.userId === lastId);

  // Walk forward from the position after the last-assigned member, wrapping
  // around the full roster, and pick the first available member we hit.
  let member = available[0]!;
  const start = lastPos < 0 ? 0 : lastPos + 1;
  for (let step = 0; step < ordered.length; step++) {
    const candidate = ordered[(start + step) % ordered.length]!;
    if (candidate.isAvailable !== false) {
      member = candidate;
      break;
    }
  }

  // Update state to the chosen member's identity.
  state.lastAssignedUserId = member.userId;

  const position = available.findIndex(m => m.userId === member.userId) + 1;

  return {
    assignedTo: member.userId,
    reason: `Round robin assignment (position ${position} of ${available.length})`,
    strategy: 'round_robin',
  };
}

/**
 * Territory-based assignment - matches entity location to territory owner.
 * Falls back to first available member if no territory match.
 */
export function territoryBased(config: TerritoryConfig): AssignmentResult {
  const { members, entityLocation } = config;

  if (members.length === 0) {
    throw new Error('No team members available for assignment');
  }

  const locationLower = entityLocation.toLowerCase();

  // Find member whose territory matches the entity location
  const match = members.find(m =>
    m.isAvailable !== false &&
    m.territories?.some(t => locationLower.includes(t.toLowerCase()) || t.toLowerCase().includes(locationLower))
  );

  if (match) {
    return {
      assignedTo: match.userId,
      reason: `Territory match: "${entityLocation}" matched to territory owner`,
      strategy: 'territory',
    };
  }

  // Fallback to first available member
  const fallback = members.find(m => m.isAvailable !== false);
  if (!fallback) {
    throw new Error('No available team members for territory assignment');
  }

  return {
    assignedTo: fallback.userId,
    reason: `No territory match for "${entityLocation}", assigned to fallback`,
    strategy: 'territory',
  };
}

/**
 * Skill-based assignment - matches required skills to agent skills.
 * Selects the agent with the most matching skills.
 */
export function skillBased(config: SkillConfig): AssignmentResult {
  const { members, requiredSkills, matchMode = 'any' } = config;

  if (members.length === 0) {
    throw new Error('No team members available for assignment');
  }

  const available = members.filter(m => m.isAvailable !== false);
  if (available.length === 0) {
    throw new Error('No available team members for skill-based assignment');
  }

  // Score each member by how many required skills they have
  const scored = available.map(member => {
    const memberSkills = (member.skills ?? []).map(s => s.toLowerCase());
    const matchCount = requiredSkills.filter(skill =>
      memberSkills.includes(skill.toLowerCase())
    ).length;

    const hasAll = matchCount === requiredSkills.length;
    const hasAny = matchCount > 0;

    return { member, matchCount, hasAll, hasAny };
  });

  // Filter by match mode
  let candidates = scored;
  if (matchMode === 'all') {
    candidates = scored.filter(s => s.hasAll);
  } else {
    candidates = scored.filter(s => s.hasAny);
  }

  // Sort by match count (descending)
  candidates.sort((a, b) => b.matchCount - a.matchCount);

  if (candidates.length > 0) {
    const best = candidates[0]!;
    return {
      assignedTo: best.member.userId,
      reason: `Skill match: ${best.matchCount}/${requiredSkills.length} skills matched (${matchMode} mode)`,
      strategy: 'skill_based',
    };
  }

  // Fallback to first available
  const fallback = available[0]!;
  return {
    assignedTo: fallback.userId,
    reason: `No skill match found, assigned to fallback`,
    strategy: 'skill_based',
  };
}

/**
 * Weighted random assignment - distributes by configured weights.
 * Higher weight = higher probability of assignment.
 */
export function weightedRandom(config: WeightedConfig): AssignmentResult {
  const { members } = config;

  if (members.length === 0) {
    throw new Error('No team members available for assignment');
  }

  const available = members.filter(m => m.isAvailable !== false);
  if (available.length === 0) {
    throw new Error('No available team members for weighted assignment');
  }

  // Calculate total weight (default weight is 1)
  const totalWeight = available.reduce((sum, m) => sum + (m.weight ?? 1), 0);

  // Generate random value
  let random = Math.random() * totalWeight;
  let selected: TeamMember | undefined;

  for (const member of available) {
    random -= (member.weight ?? 1);
    if (random <= 0) {
      selected = member;
      break;
    }
  }

  // Fallback safety
  if (!selected) {
    selected = available[available.length - 1]!;
  }

  const weight = selected.weight ?? 1;
  const percentage = Math.round((weight / totalWeight) * 100);

  return {
    assignedTo: selected.userId,
    reason: `Weighted random: ${percentage}% probability (weight ${weight}/${totalWeight})`,
    strategy: 'weighted',
  };
}
