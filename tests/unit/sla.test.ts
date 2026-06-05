import { describe, it, expect } from 'vitest';
import { defineSLA, checkSLABreach, getEscalationChain, DEFAULT_SLA_TIMES } from '@/lib/sla';
import type { SLADefinition, EscalationRule } from '@/lib/sla';

describe('SLA Engine - defineSLA', () => {
  it('creates SLA with default times for critical priority', () => {
    const sla = defineSLA({ name: 'Critical SLA', priority: 'critical' });

    expect(sla.name).toBe('Critical SLA');
    expect(sla.priority).toBe('critical');
    expect(sla.responseTimeMinutes).toBe(15);
    expect(sla.resolutionTimeMinutes).toBe(60);
    expect(sla.escalationRules).toHaveLength(3);
  });

  it('creates SLA with custom times overriding defaults', () => {
    const sla = defineSLA({
      name: 'Custom SLA',
      priority: 'high',
      responseTimeMinutes: 30,
      resolutionTimeMinutes: 120,
    });

    expect(sla.responseTimeMinutes).toBe(30);
    expect(sla.resolutionTimeMinutes).toBe(120);
  });

  it('creates SLA with custom escalation rules', () => {
    const rules: EscalationRule[] = [
      { level: 1, afterMinutes: 30, notifyUserIds: ['user-1'], action: 'notify' },
      { level: 2, afterMinutes: 60, notifyUserIds: ['user-2'], action: 'escalate' },
    ];

    const sla = defineSLA({ name: 'Escalation SLA', priority: 'medium', escalationRules: rules });

    expect(sla.escalationRules).toHaveLength(2);
    expect(sla.escalationRules[0]!.notifyUserIds).toContain('user-1');
    expect(sla.escalationRules[1]!.action).toBe('escalate');
  });
});

describe('SLA Engine - checkSLABreach', () => {
  it('detects response SLA breach when no first response', () => {
    const sla = defineSLA({ name: 'Test', priority: 'critical' }); // 15 min response
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T10:30:00Z'); // 30 minutes later

    const result = checkSLABreach(sla, createdAt, null, null, now);

    expect(result.breached).toBe(true);
    expect(result.breachType).toBe('response');
    expect(result.minutesOverdue).toBe(15); // 30 - 15 = 15 minutes overdue
  });

  it('does not detect breach when within response time', () => {
    const sla = defineSLA({ name: 'Test', priority: 'high' }); // 60 min response
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T10:30:00Z'); // 30 minutes later

    const result = checkSLABreach(sla, createdAt, null, null, now);

    expect(result.breached).toBe(false);
    expect(result.breachType).toBeNull();
    expect(result.minutesOverdue).toBe(0);
  });

  it('detects resolution breach when responded but not resolved', () => {
    const sla = defineSLA({ name: 'Test', priority: 'medium' }); // 480 min resolution
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const firstResponse = new Date('2024-01-01T10:30:00Z');
    const now = new Date('2024-01-01T20:00:00Z'); // 10 hours later (600 min)

    const result = checkSLABreach(sla, createdAt, firstResponse, null, now);

    expect(result.breached).toBe(true);
    expect(result.breachType).toBe('resolution');
    expect(result.minutesOverdue).toBe(120); // 600 - 480 = 120 minutes overdue
  });

  it('no breach when ticket is resolved within time', () => {
    const sla = defineSLA({ name: 'Test', priority: 'low' }); // 1440 min resolution
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const firstResponse = new Date('2024-01-01T10:30:00Z');
    const resolvedAt = new Date('2024-01-01T18:00:00Z'); // resolved in 8 hours

    const result = checkSLABreach(sla, createdAt, firstResponse, resolvedAt, new Date('2024-01-02T10:00:00Z'));

    expect(result.breached).toBe(false);
  });

  it('calculates correct escalation level on breach', () => {
    const rules: EscalationRule[] = [
      { level: 1, afterMinutes: 20, notifyUserIds: ['user-1'], action: 'notify' },
      { level: 2, afterMinutes: 40, notifyUserIds: ['user-2'], action: 'escalate' },
      { level: 3, afterMinutes: 60, notifyUserIds: ['user-3'], action: 'reassign' },
    ];
    const sla = defineSLA({ name: 'Test', priority: 'critical', responseTimeMinutes: 15, escalationRules: rules });
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T10:50:00Z'); // 50 minutes later, response breach + 35 min overdue

    const result = checkSLABreach(sla, createdAt, null, null, now);

    expect(result.breached).toBe(true);
    expect(result.escalationLevel).toBe(2); // 50 total min >= 40 afterMinutes for level 2
  });
});

describe('SLA Engine - getEscalationChain', () => {
  it('returns all levels with triggered status', () => {
    const rules: EscalationRule[] = [
      { level: 1, afterMinutes: 10, notifyUserIds: ['user-1'], action: 'notify' },
      { level: 2, afterMinutes: 30, notifyUserIds: ['user-2'], action: 'escalate' },
      { level: 3, afterMinutes: 60, notifyUserIds: ['user-3'], action: 'reassign' },
    ];
    const sla = defineSLA({ name: 'Test', priority: 'high', escalationRules: rules });
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T10:35:00Z'); // 35 min later

    const chain = getEscalationChain(sla, createdAt, now);

    expect(chain).toHaveLength(3);
    expect(chain[0]!.triggered).toBe(true);  // 35 >= 10
    expect(chain[1]!.triggered).toBe(true);  // 35 >= 30
    expect(chain[2]!.triggered).toBe(false); // 35 < 60
  });

  it('returns no triggered levels when within initial window', () => {
    const rules: EscalationRule[] = [
      { level: 1, afterMinutes: 30, notifyUserIds: ['user-1'], action: 'notify' },
      { level: 2, afterMinutes: 60, notifyUserIds: ['user-2'], action: 'escalate' },
    ];
    const sla = defineSLA({ name: 'Test', priority: 'low', escalationRules: rules });
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const now = new Date('2024-01-01T10:05:00Z'); // only 5 minutes

    const chain = getEscalationChain(sla, createdAt, now);

    expect(chain.every(e => e.triggered === false)).toBe(true);
  });
});

describe('SLA Engine - DEFAULT_SLA_TIMES', () => {
  it('has correct default response and resolution times', () => {
    expect(DEFAULT_SLA_TIMES['critical']!.response).toBe(15);
    expect(DEFAULT_SLA_TIMES['critical']!.resolution).toBe(60);
    expect(DEFAULT_SLA_TIMES['high']!.response).toBe(60);
    expect(DEFAULT_SLA_TIMES['high']!.resolution).toBe(240);
    expect(DEFAULT_SLA_TIMES['medium']!.response).toBe(240);
    expect(DEFAULT_SLA_TIMES['medium']!.resolution).toBe(480);
    expect(DEFAULT_SLA_TIMES['low']!.response).toBe(480);
    expect(DEFAULT_SLA_TIMES['low']!.resolution).toBe(1440);
  });
});
