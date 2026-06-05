/**
 * SLA Engine
 *
 * Manages Service Level Agreements for helpdesk/support tickets.
 * Supports priority-based SLAs with configurable response and resolution times,
 * breach detection, and multi-level escalation chains.
 */

export interface SLADefinition {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  escalationRules: EscalationRule[];
}

export interface EscalationRule {
  level: number;
  afterMinutes: number;
  notifyUserIds: string[];
  action: 'notify' | 'reassign' | 'escalate';
}

export interface SLABreachResult {
  breached: boolean;
  breachType: 'response' | 'resolution' | null;
  minutesOverdue: number;
  escalationLevel: number;
}

export interface EscalationChainEntry {
  level: number;
  afterMinutes: number;
  notifyUserIds: string[];
  action: 'notify' | 'reassign' | 'escalate';
  triggered: boolean;
}

/**
 * Default priority-based SLA times (in minutes).
 */
export const DEFAULT_SLA_TIMES: Record<string, { response: number; resolution: number }> = {
  critical: { response: 15, resolution: 60 },
  high: { response: 60, resolution: 240 },
  medium: { response: 240, resolution: 480 },
  low: { response: 480, resolution: 1440 },
};

/**
 * Define an SLA policy with priority-based defaults if not specified.
 */
export function defineSLA(input: {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  responseTimeMinutes?: number;
  resolutionTimeMinutes?: number;
  escalationRules?: EscalationRule[];
}): SLADefinition {
  const defaults = DEFAULT_SLA_TIMES[input.priority] ?? DEFAULT_SLA_TIMES['medium']!;
  return {
    name: input.name,
    priority: input.priority,
    responseTimeMinutes: input.responseTimeMinutes ?? defaults.response,
    resolutionTimeMinutes: input.resolutionTimeMinutes ?? defaults.resolution,
    escalationRules: input.escalationRules ?? getDefaultEscalationRules(input.priority),
  };
}

/**
 * Get default escalation rules based on priority.
 */
function getDefaultEscalationRules(priority: string): EscalationRule[] {
  const baseMinutes = DEFAULT_SLA_TIMES[priority]?.response ?? 240;
  return [
    { level: 1, afterMinutes: baseMinutes, notifyUserIds: [], action: 'notify' },
    { level: 2, afterMinutes: baseMinutes * 2, notifyUserIds: [], action: 'escalate' },
    { level: 3, afterMinutes: baseMinutes * 3, notifyUserIds: [], action: 'reassign' },
  ];
}

/**
 * Check if an SLA has been breached.
 * Compares current time against the target time based on when the ticket was created.
 *
 * @param sla - The SLA policy definition
 * @param createdAt - When the ticket/entity was created
 * @param firstResponseAt - When the first response was made (null if no response yet)
 * @param resolvedAt - When the ticket was resolved (null if not resolved)
 * @param now - Current time (defaults to Date.now())
 */
export function checkSLABreach(
  sla: SLADefinition,
  createdAt: Date,
  firstResponseAt: Date | null,
  resolvedAt: Date | null,
  now: Date = new Date()
): SLABreachResult {
  const createdTime = createdAt.getTime();
  const currentTime = now.getTime();

  // Check response breach first
  if (!firstResponseAt) {
    const responseDeadline = createdTime + sla.responseTimeMinutes * 60 * 1000;
    if (currentTime > responseDeadline) {
      const minutesOverdue = Math.floor((currentTime - responseDeadline) / (60 * 1000));
      const escalationLevel = getEscalationLevel(sla.escalationRules, minutesOverdue + sla.responseTimeMinutes);
      return {
        breached: true,
        breachType: 'response',
        minutesOverdue,
        escalationLevel,
      };
    }
  }

  // Check resolution breach
  if (!resolvedAt) {
    const resolutionDeadline = createdTime + sla.resolutionTimeMinutes * 60 * 1000;
    if (currentTime > resolutionDeadline) {
      const minutesOverdue = Math.floor((currentTime - resolutionDeadline) / (60 * 1000));
      const escalationLevel = getEscalationLevel(sla.escalationRules, minutesOverdue + sla.resolutionTimeMinutes);
      return {
        breached: true,
        breachType: 'resolution',
        minutesOverdue,
        escalationLevel,
      };
    }
  }

  return { breached: false, breachType: null, minutesOverdue: 0, escalationLevel: 0 };
}

/**
 * Determine the current escalation level based on elapsed minutes.
 */
function getEscalationLevel(rules: EscalationRule[], elapsedMinutes: number): number {
  let level = 0;
  const sorted = [...rules].sort((a, b) => a.afterMinutes - b.afterMinutes);
  for (const rule of sorted) {
    if (elapsedMinutes >= rule.afterMinutes) {
      level = rule.level;
    }
  }
  return level;
}

/**
 * Get the full escalation chain for a given SLA and elapsed time.
 * Returns all escalation levels with whether they have been triggered.
 */
export function getEscalationChain(
  sla: SLADefinition,
  createdAt: Date,
  now: Date = new Date()
): EscalationChainEntry[] {
  const elapsedMinutes = Math.floor((now.getTime() - createdAt.getTime()) / (60 * 1000));
  const sorted = [...sla.escalationRules].sort((a, b) => a.afterMinutes - b.afterMinutes);

  return sorted.map(rule => ({
    level: rule.level,
    afterMinutes: rule.afterMinutes,
    notifyUserIds: rule.notifyUserIds,
    action: rule.action,
    triggered: elapsedMinutes >= rule.afterMinutes,
  }));
}
