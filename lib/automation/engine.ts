/**
 * Automation Execution Engine
 *
 * Evaluates active automation rules against trigger events and executes
 * matching actions. Called when key CRM events occur (contact.created,
 * deal.won, etc.).
 *
 * Supports trigger types:
 *   contact.created | contact.updated
 *   deal.created    | deal.updated | deal.stage_changed | deal.won | deal.lost
 *   task.created    | task.completed
 *   ticket.created
 *   invoice.created | invoice.paid
 */

import { db } from '@/drizzle/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
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
import { captureError } from '@/lib/capture-error';

export type TriggerEvent =
  | 'contact.created' | 'contact.updated'
  | 'deal.created'    | 'deal.updated' | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed'
  | 'ticket.created'
  | 'invoice.created' | 'invoice.paid';

export interface TriggerPayload {
  tenantId: string;
  userId?: string;
  event: TriggerEvent;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  contactId?: string;
  dealId?: string;
}

/**
 * Evaluate all active automations for a given event and run matching ones.
 * Non-blocking: errors are caught per-automation so one failure doesn't stop others.
 * Each automation's actions + audit log are wrapped in a transaction for atomicity.
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!meetsConditions(automation.conditions as any[], enrichedData)) continue;

        await db.transaction(async (tx) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const action of (automation.actions as any[] ?? [])) {
            await executeAction(tx, action, payload, enrichedData);
          }

          await tx.insert(automationRuns).values({
            tenantId: payload.tenantId,
            automationId: automation.id,
            triggerEvent: payload.event,
            status: 'success',
            triggeredBy: payload.userId || null,
            metadata: enrichedData,
          });
        });

  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        captureError(err, `automation:${automation.name}`);

        await db.insert(automationRuns).values({
          tenantId: payload.tenantId,
          automationId: automation.id,
          triggerEvent: payload.event,
          status: 'failed',
          triggeredBy: payload.userId || null,
          errorMessage: err.message,
          metadata: payload.data,
        }).catch((err) => captureError(err, 'automation:log-failed-run'));
      }
    }
  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    captureError(err, 'automation:evaluate');
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeAction(dbOrTx: NodePgDatabase | typeof db, action: any, payload: TriggerPayload, enrichedData: Record<string, any>): Promise<void> {
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
        await dbOrTx.update(contacts).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(contacts.id, resourceId), eq(contacts.tenantId, payload.tenantId)));
      } else if (resource === 'deals') {
        await dbOrTx.update(deals).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(deals.id, resourceId), eq(deals.tenantId, payload.tenantId)));
      } else if (resource === 'tasks') {
        await dbOrTx.update(tasks).set({ [field]: value, updatedAt: new Date() })
          .where(and(eq(tasks.id, resourceId), eq(tasks.tenantId, payload.tenantId)));
      }
      break;
    }

    case 'create_task': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      await dbOrTx.insert(tasks).values({
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
        await dbOrTx.execute(sql`
          SELECT public.enroll_contact_in_sequence(
            ${payload.tenantId}::uuid, 
            ${sequenceId}::uuid, 
            ${contactId}::uuid, 
            ${payload.userId || null}::uuid
          )
        `);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        captureError(err, 'automation:sequence-enrollment');
      }
      break;
    }

    case 'log_call': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      if (!contactId) return;
      await dbOrTx.insert(callLogs).values({
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
      
      const integration = await dbOrTx.query.integrations.findFirst({
        where: and(
          eq(integrations.tenantId, payload.tenantId),
          eq(integrations.type, 'whatsapp'),
          eq(integrations.isActive, true)
        )
      });

      const configObj = integration?.config as { phone_number_id?: string; access_token?: string } | undefined;
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        captureError(err, 'automation:whatsapp-send');
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error(`[automation] Webhook failed for ${config.url}:`, err.message);
      }
      break;
    }

    case 'assign_contact': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      const assignTo = config.assigned_to || enrichedData?.['assigned_to'];
      if (!contactId || !assignTo) return;
      await dbOrTx.update(contacts).set({ assignedTo: assignTo, updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, payload.tenantId)));
      break;
    }

    case 'create_deal': {
      const contactId = enrichedData?.['contact_id'] || enrichedData?.['id'];
      const companyId = enrichedData?.['company_id'] || null;
      const pipelineId = config.pipeline_id || null;
      const stageId = config.stage_id || null;
      if (!stageId) return;
      await dbOrTx.insert(deals).values({
        tenantId: payload.tenantId,
        title: interpolate(config.title || 'New Deal', enrichedData),
        amount: config.amount || '0',
        pipelineId,
        stageId,
        contactId: contactId || null,
        companyId,
        assignedTo: config.assigned_to || payload.userId || null,
        createdBy: payload.userId || null,
      });
      break;
    }

    case 'remove_tag': {
      const resource = config.resource || 'contacts';
      const resourceId = enrichedData?.[config.id_field || 'id'];
      const tagToRemove = config.tag;
      if (!resourceId || !tagToRemove) return;

      if (resource === 'contacts') {
        const [existing] = await dbOrTx.select({ tags: contacts.tags })
          .from(contacts)
          .where(and(eq(contacts.id, resourceId), eq(contacts.tenantId, payload.tenantId)))
          .limit(1);
        if (existing?.tags) {
          const newTags = existing.tags.filter((t: string) => t !== tagToRemove);
          await dbOrTx.update(contacts).set({ tags: newTags, updatedAt: new Date() })
            .where(eq(contacts.id, resourceId));
        }
      }
      break;
    }

    case 'send_sms': {
      const to = config.to || enrichedData?.['phone'];
      if (!to) return;
      const smsIntegration = await dbOrTx.query.integrations.findFirst({
        where: and(
          eq(integrations.tenantId, payload.tenantId),
          eq(integrations.type, 'sms'),
          eq(integrations.isActive, true)
        )
      });
      if (!smsIntegration) {
        console.warn(`[automation] SMS not configured for tenant ${payload.tenantId}`);
        return;
      }
      try {
        const smsConfig = smsIntegration.config as { api_key?: string; from_number?: string };
        await fetch('https://api.twilio.com/2010-04-01/Accounts.json/Messages.json', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(`${smsConfig.api_key}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: to,
            From: smsConfig.from_number || '',
            Body: interpolate(config.body || '', enrichedData),
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        captureError(new Error(`SMS send failed: ${message}`), 'automation:sms-send');
      }
      break;
    }

    default:
      console.warn(`[automation] Unknown action type: ${type}`);
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}
