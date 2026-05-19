/**
 * Automation Execution Engine
 *
 * Evaluates active automation rules against trigger events and executes
 * matching actions. Called when key CRM events occur (contact.created,
 * deal.won, etc.).
 *
 * Supports trigger types:
 *   contact.created | contact.updated
 *   deal.created    | deal.updated | deal.won | deal.lost
 *   task.created    | task.completed
 */

import { db } from '@/drizzle/db';
import { 
  automations, 
  automationRuns, 
  contacts, 
  deals, 
  tasks, 
  callLogs, 
  integrations 
} from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';

export type TriggerEvent =
  | 'contact.created' | 'contact.updated'
  | 'deal.created'    | 'deal.updated' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed';

export interface TriggerPayload {
  tenantId: string;
  userId?: string;
  event: TriggerEvent;
  data: Record<string, any>;
  contactId?: string;
  dealId?: string;
}

/**
 * Evaluate all active automations for a given event and run matching ones.
 * Non-blocking: errors are caught per-automation so one failure doesn't stop others.
 */
export async function evaluateAutomations(payload: TriggerPayload): Promise<void> {
  try {
    const activeAutomations = await db.query.automations.findMany({
      where: and(
        eq(automations.tenantId, payload.tenantId),
        eq(automations.isActive, true),
        eq(automations.triggerType, payload.event)
      ),
      orderBy: (automations, { asc }) => [asc(automations.createdAt)]
    });

    if (!activeAutomations.length) return;

    for (const automation of activeAutomations) {
      try {
        const enrichedData = {
          ...payload.data,
          contact_id: payload.contactId ?? payload.data?.['contact_id'],
          deal_id: payload.dealId ?? payload.data?.['deal_id'],
        };

        if (!meetsConditions(automation.conditions as any[], enrichedData)) continue;

        for (const action of (automation.actions as any[] ?? [])) {
          await executeAction(action, payload, enrichedData);
        }

        await db.insert(automationRuns).values({
          tenantId: payload.tenantId,
          automationId: automation.id,
          triggerEvent: payload.event,
          status: 'success',
          triggeredBy: payload.userId || null,
          metadata: enrichedData,
        }).catch((err) => console.error('[automation] Failed to log run:', err.message));

      } catch (err: any) {
        console.error(`[automation] ${automation.name} (${automation.id}) failed:`, err.message);

        await db.insert(automationRuns).values({
          tenantId: payload.tenantId,
          automationId: automation.id,
          triggerEvent: payload.event,
          status: 'failed',
          triggeredBy: payload.userId || null,
          errorMessage: err.message,
          metadata: payload.data,
        }).catch((err) => console.error('[automation] Failed to log failed run:', err.message));
      }
    }
  } catch (err: any) {
    console.error('[automation] evaluateAutomations error:', err.message);
  }
}

function meetsConditions(conditions: any[], data: Record<string, any>): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;

  return conditions.every((cond) => {
    const fieldVal = getNestedValue(data, cond.field);
    switch (cond.operator) {
      case 'equals':          return String(fieldVal) === String(cond.value);
      case 'not_equals':      return String(fieldVal) !== String(cond.value);
      case 'contains':        return String(fieldVal ?? '').includes(cond.value);
      case 'not_contains':    return !String(fieldVal ?? '').includes(cond.value);
      case 'greater_than':    return Number(fieldVal) > Number(cond.value);
      case 'less_than':       return Number(fieldVal) < Number(cond.value);
      case 'is_empty':        return fieldVal == null || fieldVal === '';
      case 'is_not_empty':   return fieldVal != null && fieldVal !== '';
      default:               return true;
    }
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

async function executeAction(action: any, payload: TriggerPayload, enrichedData: Record<string, any>): Promise<void> {
  const { type, config = {} } = action;

  switch (type) {
    case 'send_email': {
      const to = config.to || enrichedData?.['email'];
      if (!to) return;
      await sendEmail({
        to,
        subject: config.subject || 'Automated message from NuCRM',
        html: interpolate(config.body || '', enrichedData),
      });
      break;
    }

    case 'send_notification': {
      const userId = config.user_id || enrichedData?.['assigned_to'] || payload.userId;
      if (!userId) return;
      await createNotification({
        userId,
        tenantId: payload.tenantId,
        type: 'system',
        title: interpolate(config.title || 'Automation triggered', enrichedData),
        body:  config.body ? interpolate(config.body, enrichedData) : undefined,
        link:  config.link || undefined,
      });
      break;
    }

    case 'update_field': {
      const { resource, id_field, field, value } = config;
      const resourceId = enrichedData?.[id_field || 'id'];
      if (!resourceId || !resource || !field) return;

      const allowed: Record<string, string[]> = {
        contacts: ['leadStatus','lifecycleStage','assignedTo','score','tags'],
        deals:    ['stage','probability','assignedTo'],
        tasks:    ['priority','assignedTo'],
      };
      if (!allowed[resource]?.includes(field)) return;

      if (resource === 'contacts') {
        await db.update(contacts).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(contacts.id, resourceId), eq(contacts.tenantId, payload.tenantId)));
      } else if (resource === 'deals') {
        await db.update(deals).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(deals.id, resourceId), eq(deals.tenantId, payload.tenantId)));
      } else if (resource === 'tasks') {
        await db.update(tasks).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(tasks.id, resourceId), eq(tasks.tenantId, payload.tenantId)));
      }
      break;
    }

    case 'create_task': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      await db.insert(tasks).values({
        tenantId: payload.tenantId,
        title: interpolate(config.title || 'Follow up', enrichedData),
        priority: config.priority || 'medium',
        contactId: contactId || null,
        dealId: enrichedData?.['deal_id'] || null,
        assignedTo: config.assigned_to || payload.userId || null,
        createdBy: payload.userId || null,
        completed: false,
      });
      break;
    }

    case 'enroll_sequence': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      const sequenceId = config.sequence_id;
      if (!contactId || !sequenceId) return;

      try {
        await db.execute(sql`
          SELECT public.enroll_contact_in_sequence(
            ${payload.tenantId}::uuid, 
            ${sequenceId}::uuid, 
            ${contactId}::uuid, 
            ${payload.userId || null}::uuid
          )
        `);
      } catch (err: any) {
        console.error(`[automation] Sequence enrollment failed:`, err.message);
      }
      break;
    }

    case 'log_call': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      if (!contactId) return;
      await db.insert(callLogs).values({
        tenantId: payload.tenantId,
        contactId,
        userId: payload.userId || null,
        direction: config.direction || 'outbound',
        duration: config.duration || 0,
        notes: interpolate(config.notes || 'Automated call logged by workflow', enrichedData),
        phoneNumber: config.phone_number || enrichedData?.['phone'] || null,
      });
      break;
    }

    case 'send_whatsapp': {
      const to = config.to || enrichedData?.['phone'];
      if (!to) return;
      
      const integration = await db.query.integrations.findFirst({
        where: and(
          eq(integrations.tenantId, payload.tenantId),
          eq(integrations.type, 'whatsapp'),
          eq(integrations.isActive, true)
        )
      });

      const configObj = integration?.config as any;
      const phoneNumberId = configObj?.phone_number_id;
      const accessToken = configObj?.access_token;

      if (!phoneNumberId || !accessToken) {
        console.warn(`[automation] WhatsApp not configured for tenant ${payload.tenantId} — skipping send_whatsapp`);
        return;
      }
      try {
        await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to.replace(/[^0-9]/g, ''),
            type: 'template',
            template: {
              name: config.template_name || 'hello_world',
              language: { code: config.language || 'en' },
              components: config.template_components || [],
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err: any) {
        console.error('[automation] WhatsApp send failed:', err.message);
      }
      break;
    }

    case 'fire_webhook': {
      if (!config.url) return;
      try {
        await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: payload.event,
            timestamp: new Date().toISOString(),
            tenant_id: payload.tenantId,
            contact_id: payload.contactId,
            deal_id: payload.dealId,
            data: enrichedData,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err: any) {
        console.error(`[automation] Webhook failed for ${config.url}:`, err.message);
      }
      break;
    }

    default:
      console.warn(`[automation] Unknown action type: ${type}`);
  }
}

function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}
