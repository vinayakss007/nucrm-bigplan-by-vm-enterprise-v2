/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * D5: Send-Time Optimization
 *
 * Analyzes contact open history to determine the optimal send time.
 * Falls back to weekday 9 AM for contacts with no history.
 */

interface OpenRecord {
  dayOfWeek: number; // 1=Mon, 7=Sun
  hour: number;      // 0-23
  opened: boolean;
}

interface SendTimeInput {
  openHistory: OpenRecord[];
}

interface SendTimeResult {
  dayOfWeek: number;
  hour: number;
  confidence: number; // 0 = no history, 1 = strong signal
}

export function classifyTimeSlot(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Computes the optimal send time from open history.
 * Groups by day-of-week and hour, picks the slot with the most opens,
 * then averages if there are multiple strong slots.
 */
export function getOptimalSendTime(input: SendTimeInput): SendTimeResult {
  const opened = input.openHistory.filter(r => r.opened);

  // No history: default to weekday 9 AM
  if (opened.length === 0) {
    return { dayOfWeek: 1, hour: 9, confidence: 0 };
  }

  // Count opens per (day, hour) slot
  const slotCounts = new Map<string, { day: number; hour: number; count: number }>();
  for (const r of opened) {
    const key = `${r.dayOfWeek}-${r.hour}`;
    const existing = slotCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      slotCounts.set(key, { day: r.dayOfWeek, hour: r.hour, count: 1 });
    }
  }

  // Find max count
  const slots = Array.from(slotCounts.values());
  const maxCount = Math.max(...slots.map(s => s.count));

  // Get all slots at max count
  const bestSlots = slots.filter(s => s.count === maxCount);

  // Average the best slots
  const avgHour = Math.round(bestSlots.reduce((sum, s) => sum + s.hour, 0) / bestSlots.length);
  const avgDay = Math.round(bestSlots.reduce((sum, s) => sum + s.day, 0) / bestSlots.length);

  // Confidence: ratio of best-slot opens to total opens
  const confidence = maxCount / opened.length;

  return {
    dayOfWeek: avgDay,
    hour: avgHour,
    confidence,
  };
}
