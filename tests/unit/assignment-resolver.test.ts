/* eslint-disable @typescript-eslint/no-explicit-any -- the drizzle tx mock is intentionally loosely typed */
import { describe, it, expect } from 'vitest';
import { resolveAssignee } from '@/lib/assignment-resolver';

/**
 * Builds a mock drizzle transaction that mimics the fluent builder the resolver
 * uses, and records the update/insert payloads so we can assert on them.
 *
 *   tx.select().from().where().orderBy().limit().for('update')  -> rules[]
 *   tx.update().set(vals).where()                               -> records vals
 *   tx.insert().values(vals)                                    -> records vals
 */
function makeTx(rules: any[], roster: any[] = []) {
  const calls = { updates: [] as any[], inserts: [] as any[] };
  // The rules query ends in .for('update') and returns rules synchronously. The
  // team-roster query ends in .where() and is awaited, so the chain is thenable
  // and resolves to the roster.
  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => selectChain,
    for: () => rules,
    then: (resolve: (v: any[]) => void) => resolve(roster),
  };
  const tx: any = {
    select: () => selectChain,
    update: () => ({
      set: (vals: any) => ({
        where: () => {
          calls.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (vals: any) => {
        calls.inserts.push(vals);
        return Promise.resolve();
      },
    }),
  };
  return { tx, calls };
}

const base = {
  tenantId: 't-1',
  entityType: 'lead' as const,
  entityId: 'lead-1',
};

describe('resolveAssignee', () => {
  it('returns null when no active rule exists', async () => {
    const { tx, calls } = makeTx([]);
    const result = await resolveAssignee(tx, base);
    expect(result).toBeNull();
    expect(calls.inserts).toHaveLength(0);
  });

  it('returns null when the rule has no members', async () => {
    const { tx } = makeTx([{ id: 'r1', type: 'round_robin', config: { members: [] } }]);
    expect(await resolveAssignee(tx, base)).toBeNull();
  });

  it('round_robin picks the next member, logs it, and persists the cursor', async () => {
    const rule = {
      id: 'r1',
      type: 'round_robin',
      config: {
        members: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }],
        lastAssignedUserId: 'u1', // last went to u1 -> next should be u2
      },
    };
    const { tx, calls } = makeTx([rule]);
    const result = await resolveAssignee(tx, base);

    expect(result?.assignedTo).toBe('u2');
    expect(result?.strategy).toBe('round_robin');
    expect(result?.ruleId).toBe('r1');

    // cursor advanced to the chosen member's identity and written back
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].config.lastAssignedUserId).toBe('u2');

    // decision recorded in assignment_logs
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      tenantId: 't-1',
      ruleId: 'r1',
      entityType: 'lead',
      entityId: 'lead-1',
      assignedTo: 'u2',
    });
  });

  it('weighted assignment returns a member and logs it (no cursor write)', async () => {
    const rule = {
      id: 'rw',
      type: 'weighted',
      config: { members: [{ userId: 'u1', weight: 1 }, { userId: 'u2', weight: 1 }] },
    };
    const { tx, calls } = makeTx([rule]);
    const result = await resolveAssignee(tx, base);

    expect(['u1', 'u2']).toContain(result?.assignedTo);
    expect(result?.strategy).toBe('weighted');
    expect(calls.updates).toHaveLength(0);
    expect(calls.inserts).toHaveLength(1);
  });

  it('skill_based matches the member with the most required skills', async () => {
    const rule = {
      id: 'rs',
      type: 'skill_based',
      config: {
        members: [
          { userId: 'u1', skills: ['billing'] },
          { userId: 'u2', skills: ['billing', 'legal'] },
        ],
        requiredSkills: ['billing', 'legal'],
        matchMode: 'any',
      },
    };
    const { tx } = makeTx([rule]);
    const result = await resolveAssignee(tx, base);
    expect(result?.assignedTo).toBe('u2');
    expect(result?.strategy).toBe('skill_based');
  });

  it('never throws to the caller when the engine cannot decide (all unavailable)', async () => {
    const rule = {
      id: 'r1',
      type: 'round_robin',
      config: { members: [{ userId: 'u1', isAvailable: false }] },
    };
    const { tx, calls } = makeTx([rule]);
    const result = await resolveAssignee(tx, base);
    expect(result).toBeNull(); // swallowed, falls back to caller default
    expect(calls.inserts).toHaveLength(0);
  });

  it('returns null for an unknown rule type', async () => {
    const { tx } = makeTx([{ id: 'r1', type: 'nonsense', config: { members: [{ userId: 'u1' }] } }]);
    expect(await resolveAssignee(tx, base)).toBeNull();
  });

  it('derives the member pool from a team when the rule targets a team', async () => {
    const rule = {
      id: 'rteam',
      type: 'round_robin',
      config: { teamId: 'team-1', lastAssignedUserId: null },
    };
    const roster = [{ userId: 'm1' }, { userId: 'm2' }];
    const { tx, calls } = makeTx([rule], roster);
    const result = await resolveAssignee(tx, base);
    expect(result?.assignedTo).toBe('m1');
    expect(result?.strategy).toBe('round_robin');
    expect(calls.inserts).toHaveLength(1);
  });

  it('returns null when a team-targeted rule has an empty roster', async () => {
    const rule = { id: 'rteam', type: 'weighted', config: { teamId: 'team-empty' } };
    const { tx } = makeTx([rule], []);
    expect(await resolveAssignee(tx, base)).toBeNull();
  });

  it('territory falls back to first available when no location match', async () => {
    const rule = {
      id: 'rt',
      type: 'territory',
      config: { members: [{ userId: 'u1', territories: ['west'] }, { userId: 'u2', territories: ['east'] }] },
    };
    const { tx } = makeTx([rule]);
    const result = await resolveAssignee(tx, { ...base, context: { location: 'north' } });
    expect(result?.assignedTo).toBe('u1');
    expect(result?.strategy).toBe('territory');
  });
});
