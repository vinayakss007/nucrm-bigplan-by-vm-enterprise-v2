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

  it('handles all members being unavailable except one', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', isAvailable: false },
      { userId: 'user-2', isAvailable: true },
      { userId: 'user-3', isAvailable: false },
    ];
    const state: RoundRobinState = { lastAssignedIndex: -1 };

    expect(roundRobin(members, state).assignedTo).toBe('user-2');
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

  it('includes position info in reason string', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', name: 'Alice' },
      { userId: 'user-2', name: 'Bob' },
    ];
    const state: RoundRobinState = { lastAssignedIndex: -1 };

    const result = roundRobin(members, state);
    expect(result.reason).toContain('position 1 of 2');
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

  it('falls back to first available when no territory matches', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['California'] },
      { userId: 'user-2', territories: ['New York'] },
    ];

    const result = territoryBased({ members, entityLocation: 'Alaska' });

    expect(result.assignedTo).toBe('user-1');
    expect(result.reason).toContain('fallback');
  });

  it('handles case-insensitive matching', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['california'] },
    ];

    const result = territoryBased({ members, entityLocation: 'CALIFORNIA' });

    expect(result.assignedTo).toBe('user-1');
  });

  it('matches territory containing location substring', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['San Francisco Bay Area'] },
    ];

    const result = territoryBased({ members, entityLocation: 'San Francisco' });

    expect(result.assignedTo).toBe('user-1');
  });

  it('skips unavailable members for fallback', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['California'], isAvailable: false },
      { userId: 'user-2', territories: ['Texas'], isAvailable: false },
    ];

    expect(() => territoryBased({ members, entityLocation: 'Alaska' })).toThrow('No available team members');
  });

  it('throws when no members provided', () => {
    expect(() => territoryBased({ members: [], entityLocation: 'Anywhere' })).toThrow('No team members available');
  });

  it('skips unavailable members when checking territory match', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', territories: ['California'], isAvailable: false },
      { userId: 'user-2', territories: ['California'], isAvailable: true },
    ];

    const result = territoryBased({ members, entityLocation: 'California' });
    expect(result.assignedTo).toBe('user-2');
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

    expect(result.assignedTo).toBe('user-3');
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

    expect(result.assignedTo).toBe('user-2');
  });

  it('filters by all match mode', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['javascript'] },
      { userId: 'user-2', skills: ['javascript', 'react'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['javascript', 'react'],
      matchMode: 'all',
    });

    expect(result.assignedTo).toBe('user-2');
  });

  it('falls back to first available when no skills match in any mode', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['sales'] },
      { userId: 'user-2', skills: ['marketing'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['engineering'],
    });

    expect(result.assignedTo).toBe('user-1');
    expect(result.reason).toContain('fallback');
  });

  it('falls back when no members satisfy all match mode', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['javascript'] },
      { userId: 'user-2', skills: ['java'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['javascript', 'react'],
      matchMode: 'all',
    });

    expect(result.assignedTo).toBe('user-1');
    expect(result.reason).toContain('fallback');
  });

  it('handles case-insensitive skill matching', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['JavaScript', 'React'] },
    ];

    const result = skillBased({
      members,
      requiredSkills: ['javascript', 'react'],
    });

    expect(result.assignedTo).toBe('user-1');
    expect(result.reason).toContain('2/2');
  });

  it('throws when no members provided', () => {
    expect(() => skillBased({ members: [], requiredSkills: [] })).toThrow('No team members available');
  });

  it('throws when all members are unavailable', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', skills: ['js'], isAvailable: false },
    ];

    expect(() => skillBased({ members, requiredSkills: ['js'] })).toThrow('No available team members');
  });

  it('handles members with undefined skills', () => {
    const members: TeamMember[] = [
      { userId: 'user-1' },
      { userId: 'user-2', skills: ['javascript'] },
    ];

    const result = skillBased({ members, requiredSkills: ['javascript'] });
    expect(result.assignedTo).toBe('user-2');
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

  it('throws when all members are unavailable', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 10, isAvailable: false },
      { userId: 'user-2', weight: 5, isAvailable: false },
    ];

    expect(() => weightedRandom({ members })).toThrow('No available team members');
  });

  it('skips unavailable members in weighted selection', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 10, isAvailable: false },
      { userId: 'user-2', weight: 1, isAvailable: true },
    ];

    const result = weightedRandom({ members });

    expect(result.assignedTo).toBe('user-2');
  });

  it('uses default weight of 1 when not specified', () => {
    const members: TeamMember[] = [
      { userId: 'user-1' },
      { userId: 'user-2' },
    ];

    const result = weightedRandom({ members });
    expect(['user-1', 'user-2']).toContain(result.assignedTo);
    expect(result.reason).toContain('50%');
  });

  it('distributes probability based on weights', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 0 },
      { userId: 'user-2', weight: 0 },
      { userId: 'user-3', weight: 100 },
    ];

    const results = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const r = weightedRandom({ members });
      results.set(r.assignedTo, (results.get(r.assignedTo) || 0) + 1);
    }

    expect((results.get('user-3') || 0)).toBeGreaterThan(50);
  });

  it('selects last available member as fallback', () => {
    const members: TeamMember[] = [
      { userId: 'user-1', weight: 10 },
    ];

    const result = weightedRandom({ members });
    expect(result.assignedTo).toBe('user-1');
  });
});
