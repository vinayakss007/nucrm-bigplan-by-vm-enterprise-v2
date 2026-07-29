/**
 * Assignment Resolver — the missing wiring between the assignment RULES an
 * admin configures and the pure assignment ENGINE that knows how to pick a
 * person.
 *
 * Before this existed, `lib/assignment.ts` (round-robin / territory / skill /
 * weighted) was imported by nothing, and `assignment_rules` had full admin CRUD
 * but zero effect: a rule an admin created did nothing, and every new lead was
 * silently assigned to whoever created it. See docs/workflow-gaps.md WF-03.
 *
 * This module loads the highest-priority active rule for a tenant + entity type,
 * feeds its configured members to the engine, records the decision in
 * `assignment_logs`, and returns the chosen assignee. Round-robin state
 * (`lastAssignedIndex`) is persisted back onto the rule inside the same
 * transaction, with a row lock so two concurrent intakes cannot hand the same
 * position to two people.
 *
 * It NEVER throws to the caller: assignment is a convenience, not a gate. If no
 * rule matches, the pool is empty, or the engine cannot decide, it returns
 * null and the caller falls back to its own default (usually the creator).
 */

import { and, eq, desc, isNull } from 'drizzle-orm';
import { assignmentRules, assignmentLogs, teamMembers } from '@/drizzle/schema';
import type { db as dbType } from '@/drizzle/db';
import {
  roundRobin,
  territoryBased,
  skillBased,
  weightedRandom,
  type TeamMember,
  type AssignmentResult,
} from '@/lib/assignment';
import { logError } from '@/lib/errors-server';

export type AssignableEntity = 'lead' | 'ticket' | 'deal';

/**
 * Shape of `assignment_rules.config`. All fields optional so a half-configured
 * rule degrades to "no decision" rather than an error.
 */
export interface AssignmentRuleConfig {
  /** The pool of people this rule can assign to. */
  members?: TeamMember[];
  /**
   * Route to a team: when set (and `members` is not explicitly provided) the
   * pool is loaded live from team_members, so adding/removing people from the
   * team changes routing without editing the rule.
   */
  teamId?: string;
  /** Round-robin cursor, persisted between runs. */
  lastAssignedIndex?: number;
  /** skill_based: skills the entity requires. */
  requiredSkills?: string[];
  /** skill_based: whether a member needs any or all of the required skills. */
  matchMode?: 'any' | 'all';
}

/** Signals the resolver can read off the entity being assigned. */
export interface AssignmentContext {
  /** Free-text location (city/state/country) for territory matching. */
  location?: string | null;
  /** Tags/skills the entity needs, for skill matching. */
  skills?: string[] | null;
}

export interface ResolvedAssignment {
  assignedTo: string;
  ruleId: string;
  reason: string;
  strategy: AssignmentResult['strategy'];
}

/**
 * Resolve an assignee for a new entity using the tenant's active assignment
 * rules. Must be called inside a transaction (`tx`) so the round-robin cursor
 * update and the log write commit atomically with the entity insert.
 *
 * @returns the chosen assignment, or null if no rule could decide.
 */
export async function resolveAssignee(
  tx: typeof dbType,
  params: {
    tenantId: string;
    entityType: AssignableEntity;
    entityId: string;
    context?: AssignmentContext;
  }
): Promise<ResolvedAssignment | null> {
  const { tenantId, entityType, entityId, context } = params;

  try {
    // Highest-priority active rule for this entity type. Row-locked so a
    // concurrent intake cannot read the same round-robin cursor.
    const rules = await tx
      .select()
      .from(assignmentRules)
      .where(
        and(
          eq(assignmentRules.tenantId, tenantId),
          eq(assignmentRules.entityType, entityType),
          eq(assignmentRules.isActive, true)
        )
      )
      .orderBy(desc(assignmentRules.priority))
      .limit(1)
      .for('update');

    const rule = rules[0];
    if (!rule) return null;

    const config = (rule.config ?? {}) as AssignmentRuleConfig;

    // Member pool: an explicit list on the rule wins; otherwise, if the rule
    // targets a team, load its current roster live.
    let members: TeamMember[] = config.members ?? [];
    if (members.length === 0 && config.teamId) {
      const roster = await tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.tenantId, tenantId),
            eq(teamMembers.teamId, config.teamId),
            isNull(teamMembers.deletedAt)
          )
        );
      members = roster.map((r) => ({ userId: r.userId }));
    }
    if (members.length === 0) return null;

    let result: AssignmentResult;

    switch (rule.type) {
      case 'round_robin': {
        const state = { lastAssignedIndex: config.lastAssignedIndex ?? -1 };
        result = roundRobin(members, state);
        // Persist the advanced cursor back onto the rule, in this tx.
        await tx
          .update(assignmentRules)
          .set({ config: { ...config, lastAssignedIndex: state.lastAssignedIndex } })
          .where(eq(assignmentRules.id, rule.id));
        break;
      }
      case 'territory': {
        result = territoryBased({ members, entityLocation: context?.location ?? '' });
        break;
      }
      case 'skill_based': {
        result = skillBased({
          members,
          requiredSkills: config.requiredSkills ?? context?.skills ?? [],
          matchMode: config.matchMode ?? 'any',
        });
        break;
      }
      case 'weighted': {
        result = weightedRandom({ members });
        break;
      }
      default:
        return null;
    }

    // Record the decision so it can be audited and reported on.
    await tx.insert(assignmentLogs).values({
      tenantId,
      ruleId: rule.id,
      entityType,
      entityId,
      assignedTo: result.assignedTo,
      reason: result.reason,
    });

    return {
      assignedTo: result.assignedTo,
      ruleId: rule.id,
      reason: result.reason,
      strategy: result.strategy,
    };
  } catch (err) {
    // Assignment is best-effort. A misconfigured rule (e.g. an empty available
    // pool making the engine throw) must not block the entity from being
    // created — it just falls back to the caller's default.
    logError({ error: err, context: 'assignment-resolver:resolveAssignee' });
    return null;
  }
}
