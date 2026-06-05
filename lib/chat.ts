/**
 * Live Chat Module
 *
 * Provides real-time chat session management for visitor-to-agent communication.
 * Uses polling-based approach (no WebSocket needed at API layer).
 * Gated to the 'service-helpdesk' module.
 */
import { db } from '@/drizzle/db';
import { chatSessions, chatMessages } from '@/drizzle/schema/chat';
import { contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// ── Types ──────────────────────────────────────────────

export interface CreateSessionOptions {
  visitorId: string;
  tenantId: string;
  visitorName?: string;
  visitorEmail?: string;
  channel?: string;
}

export interface SendMessageOptions {
  sessionId: string;
  tenantId: string;
  content: string;
  senderType: 'visitor' | 'agent' | 'bot';
  senderId?: string;
}

// ── Core Functions ─────────────────────────────────────

/**
 * Create a new chat session for a visitor.
 */
export async function createChatSession(options: CreateSessionOptions) {
  const [session] = await db.insert(chatSessions).values({
    visitorId: options.visitorId,
    tenantId: options.tenantId,
    visitorName: options.visitorName || null,
    visitorEmail: options.visitorEmail || null,
    channel: options.channel || 'web',
    status: 'waiting',
  }).returning();

  return session!;
}

/**
 * Send a message in a chat session.
 */
export async function sendMessage(options: SendMessageOptions) {
  // Verify session exists and belongs to tenant
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, options.sessionId),
      eq(chatSessions.tenantId, options.tenantId)
    ),
    columns: { id: true, status: true },
  });

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.status === 'closed') {
    return { success: false, error: 'Session is closed' };
  }

  const [message] = await db.insert(chatMessages).values({
    sessionId: options.sessionId,
    tenantId: options.tenantId,
    senderType: options.senderType,
    senderId: options.senderId || null,
    content: options.content,
  }).returning();

  // If session is in 'waiting' and agent sends, move to 'active'
  if (session.status === 'waiting' && options.senderType === 'agent') {
    await db.update(chatSessions)
      .set({ status: 'active' })
      .where(eq(chatSessions.id, options.sessionId));
  }

  return { success: true, message: message! };
}

/**
 * Assign an agent to a chat session.
 */
export async function assignAgent(sessionId: string, agentId: string, tenantId: string) {
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.tenantId, tenantId)
    ),
    columns: { id: true, status: true },
  });

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  await db.update(chatSessions)
    .set({ assignedTo: agentId, status: 'active' })
    .where(eq(chatSessions.id, sessionId));

  return { success: true };
}

/**
 * Close a chat session.
 */
export async function closeChatSession(sessionId: string, tenantId: string) {
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.tenantId, tenantId)
    ),
    columns: { id: true },
  });

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  await db.update(chatSessions)
    .set({ status: 'closed' })
    .where(eq(chatSessions.id, sessionId));

  return { success: true };
}

/**
 * Convert a chat session into a CRM lead/contact.
 */
export async function convertChatToLead(sessionId: string, tenantId: string) {
  const session = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.id, sessionId),
      eq(chatSessions.tenantId, tenantId)
    ),
  });

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  if (session.convertedLeadId) {
    return { success: false, error: 'Session already converted', leadId: session.convertedLeadId };
  }

  // Create a new contact from visitor info
  const [contact] = await db.insert(contacts).values({
    tenantId,
    firstName: session.visitorName || 'Chat Visitor',
    email: session.visitorEmail || null,
    leadSource: 'live_chat',
    leadStatus: 'new',
  }).returning();

  // Update session with converted lead reference
  await db.update(chatSessions)
    .set({ convertedLeadId: contact!.id })
    .where(eq(chatSessions.id, sessionId));

  return { success: true, leadId: contact!.id };
}

/**
 * Get messages for a session (polling endpoint support).
 */
export async function getSessionMessages(sessionId: string, tenantId: string, limit = 50) {
  const messages = await db.select()
    .from(chatMessages)
    .where(and(
      eq(chatMessages.sessionId, sessionId),
      eq(chatMessages.tenantId, tenantId)
    ))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return messages;
}
