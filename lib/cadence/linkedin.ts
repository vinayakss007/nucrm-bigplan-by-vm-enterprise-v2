/**
 * LinkedIn Cadence Steps
 *
 * Creates TASKS for sales reps to execute LinkedIn actions manually.
 * LinkedIn does not allow API automation for outreach, so this module
 * generates actionable tasks with pre-formatted messages and profile URLs.
 */

export type LinkedInAction = 'connect' | 'message' | 'view_profile' | 'endorse';

export interface LinkedInTask {
  id: string;
  contactId: string;
  action: LinkedInAction;
  message: string | null;
  dueAt: Date;
  linkedinUrl: string | null;
  createdAt: Date;
  status: 'pending' | 'completed' | 'skipped';
}

export interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  linkedin?: string;
  phone?: string;
  [key: string]: unknown;
}

/**
 * Create a LinkedIn task for a rep to execute manually.
 *
 * @param contactId - The contact to target
 * @param action - The LinkedIn action type
 * @param message - Optional pre-formatted message for the rep
 * @param dueAt - When the task should be completed by
 * @returns The created LinkedIn task
 */
export function createLinkedInTask(
  contactId: string,
  action: LinkedInAction,
  message: string | null,
  dueAt: Date
): LinkedInTask {
  if (!contactId) {
    throw new Error('contactId is required');
  }

  const validActions: LinkedInAction[] = ['connect', 'message', 'view_profile', 'endorse'];
  if (!validActions.includes(action)) {
    throw new Error(`Invalid LinkedIn action: ${action}. Must be one of: ${validActions.join(', ')}`);
  }

  if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) {
    throw new Error('dueAt must be a valid Date');
  }

  return {
    id: crypto.randomUUID(),
    contactId,
    action,
    message: message || null,
    dueAt,
    linkedinUrl: null,
    createdAt: new Date(),
    status: 'pending',
  };
}

/**
 * Extract the LinkedIn profile URL from a contact record.
 * Checks multiple fields where LinkedIn URLs might be stored.
 *
 * @param contact - The contact record
 * @returns LinkedIn profile URL or null if not found
 */
export function getLinkedInUrl(contact: Contact): string | null {
  if (!contact) {
    return null;
  }

  // Check direct linkedinUrl field
  if (contact.linkedinUrl && isValidLinkedInUrl(contact.linkedinUrl)) {
    return normalizeLinkedInUrl(contact.linkedinUrl);
  }

  // Check linkedin field (some schemas use this)
  if (contact.linkedin && isValidLinkedInUrl(contact.linkedin)) {
    return normalizeLinkedInUrl(contact.linkedin);
  }

  return null;
}

/**
 * Interpolate a message template with contact data.
 * Supports {{fieldName}} placeholders.
 *
 * @param template - Message template with {{placeholders}}
 * @param contact - Contact data to interpolate
 * @returns Formatted message string
 */
export function formatLinkedInMessage(template: string, contact: Contact): string {
  if (!template) {
    return '';
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = contact[key];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

// ─── Internal helpers ───────────────────────────────────────

function isValidLinkedInUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.includes('linkedin.com/in/') ||
    normalized.includes('linkedin.com/pub/')
  );
}

function normalizeLinkedInUrl(url: string): string {
  let normalized = url.trim();
  // Ensure https prefix
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  // Upgrade http to https
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
