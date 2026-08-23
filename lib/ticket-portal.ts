import { randomBytes } from 'crypto';
import { db } from '@/drizzle/db';
import { supportTickets, contacts } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

/** Generate a URL-safe portal token: 24 random bytes → 32-char base64url. */
export function generatePortalToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Validate a portal token and return the associated ticket + contact.
 * Returns null if the token is invalid or the ticket/contact doesn't exist.
 */
export async function validatePortalToken(token: string | null) {
  if (!token || token.length < 16) return null;

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.portalToken, token),
    columns: { id: true, tenantId: true, contactId: true, status: true },
  });
  if (!ticket || !ticket.contactId) return null;

  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, ticket.contactId),
    columns: { id: true, tenantId: true, email: true },
  });
  if (!contact) return null;

  return { ticket, contact };
}

/**
 * Validate a portal token and return the ticket only if it belongs to the
 * same contact and tenant. Used for single-ticket access.
 */
export async function validatePortalTokenForTicket(
  token: string | null,
  ticketId: string,
) {
  if (!token || token.length < 16) return null;

  const ticket = await db.query.supportTickets.findFirst({
    where: and(
      eq(supportTickets.portalToken, token),
      eq(supportTickets.id, ticketId),
    ),
    columns: { id: true, tenantId: true, contactId: true, status: true },
  });
  if (!ticket || !ticket.contactId) return null;

  const contact = await db.query.contacts.findFirst({
    where: eq(contacts.id, ticket.contactId),
    columns: { id: true, tenantId: true, email: true },
  });
  if (!contact) return null;

  return { ticket, contact };
}
