import { describe, it, expect } from 'vitest';
import { roundRobin, territoryBased, skillBased, weightedRandom } from '@/lib/assignment';
import type { TeamMember, RoundRobinState } from '@/lib/assignment';

describe('Assignment Engine - Round Robin', () => {
  it('assigns to the next member in sequence', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', name: 'Alice' },
      { userId: 'user-2', name: 'Bob' },
      { userId: 'user-3', name: 'Charlie' },
    ];
    const state: RoundRobinState = { lastAssignedIndex: -1 };

    const first = roundRobin(members, state);
    expect(first.assignedTo).toBe('user-1');
    expect(first.strategy).toBe('round_robin');

    const second = roundRobin(members, state);
    expect(second.assignedTo).toBe('user-2');

    const third = roundRobin(members, state);
    expect(third.assignedTo).toBe('user-3');

    // Wraps around
    const fourth = roundRobin(members, state);
    expect(fourth.assignedTo).toBe('user-1');
  });

  it('skips unavailable members', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', name: 'Alice', isAvailable: false },
      { userId: 'user-2', name: 'Bob', isAvailable: true },
      { userId: 'user-3', name: 'Charlie', isAvailable: true },
    ];
    const state: RoundRobinState = { lastAssignedIndex: -1 };

    const first = roundRobin(members, state);
    expect(first.assignedTo).toBe('user-2');

    const second = roundRobin(members, state);
    expect(second.assignedTo).toBe('user-3');
  });

  it('throws when no team members are provided', () => {
    const state: RoundRobinState = { lastAssignedIndex: -1 };
    expect(() => roundRobin([], state)).toThrow('No team members available');
  });

  it('throws when all members are unavailable', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', isAvailable: false },
      { userId: 'user-2', isAvailable: false },
    ];
    const state: RoundRobinState = { lastAssignedIndex: -1 };
    expect(() => roundRobin(members, state)).toThrow('No available team members');
  });
});

describe('Assignment Engine - Territory Based', () => {
  it('assigns to territory owner matching location', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['California', 'Oregon'] },
      { userId: 'user-2', territories: ['New York', 'Florida'] },
      { userId: 'user-3', territories: ['Texas', 'Arizona'] },
    ];

    const result = territoryBased({ members, entityLocation: 'New York' });

    expect(result.assignedTo).toBe('user-2');
    expect(result.strategy).toBe('territory');
    expect(result.reason).toContain('Territory match');
  });

  it('falls back when no territory matches', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['California'] },
      { userId: 'user-2', territories: ['New York'] },
    ];

    const result = territoryBased({ members, entityLocation: 'Alaska' });

    expect(result.assignedTo).toBe('user-1'); // first available
    expect(result.reason).toContain('fallback');
  });

  it('handles case-insensitive matching', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['california'] },
    ];

    const result = territoryBased({ members, entityLocation: 'CALIFORNIA' });

    expect(result.assignedTo).toBe('user-1');
  });
});

describe('Assignment Engine - Skill Based', () => {
  it('assigns to member with most matching skills', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['javascript', 'react'] },
      { userId: 'user-2', skills: ['python', 'django', 'react'] },
      { userId: 'user-3', skills: ['javascript', 'react', 'node'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['javascript', 'react', 'node'],
    });

    expect(result.assignedTo).toBe('user-3'); // matches all 3
    expect(result.strategy).toBe('skill_based');
  });

  it('uses any match mode by default', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['sales'] },
      { userId: 'user-2', skills: ['marketing', 'design'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['marketing', 'analytics'],
    });

    expect(result.assignedTo).toBe('user-2'); // has 1/2 skills (any mode)
  });

  it('falls back when no skills match in any mode', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['sales'] },
      { userId: 'user-2', skills: ['marketing'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['engineering'],
    });

    expect(result.assignedTo).toBe('user-1'); // fallback to first
    expect(result.reason).toContain('fallback');
  });
});

describe('Assignment Engine - Weighted Random', () => {
  it('returns a valid team member', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 5 },
      { userId: 'user-2', weight: 3 },
      { userId: 'user-3', weight: 2 },
    ];

    const result = weightedRandom({ members });

    expect(['user-1', 'user-2', 'user-3']).toContain(result.assignedTo);
    expect(result.strategy).toBe('weighted');
    expect(result.reason).toContain('Weighted random');
  });

  it('throws when no members available', () => {
    expect(() => weightedRandom({ members: [] })).toThrow('No team members available');
  });

  it('skips unavailable members in weighted selection', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 10, isAvailable: false },
      { userId: 'user-2', weight: 1, isAvailable: true },
    ];

    const result = weightedRandom({ members });

    expect(result.assignedTo).toBe('user-2');
  });
});
