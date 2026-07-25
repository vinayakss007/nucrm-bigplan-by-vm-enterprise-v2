/**
 * Workflow Execution Engine
 *
 * Executes workflows created via the visual builder (ReactFlow nodes/edges).
 * Walks the node graph, executes actions in topological order, handles
 * conditions, and updates execution status.
 */

import { db } from '@/drizzle/db';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  workflows,
  workflowExecutions,
  workflowActionLogs,
  workflowExecutionLogs,
  contacts,
  deals,
  tasks,
  callLogs,
} from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';
import { captureError } from '@/lib/capture-error';

interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

interface ExecuteWorkflowOptions {
  tenantId: string;
  userId?: string;
  workflowId: string;
  contactId?: string;
  dealId?: string;
  inputData?: Record<string, unknown>;
}

/**
 * Execute a workflow by ID, walking its node graph and running actions.
 */
export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<string> {
  const { tenantId, userId, workflowId, contactId, dealId, inputData = {} } = options;

  // Load workflow
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)))
    .limit(1);

  if (!workflow) throw new Error('Workflow not found');
  if (workflow.status !== 'active' && workflow.status !== 'draft') {
    throw new Error(`Workflow is ${workflow.status}`);
  }

  // Create execution record
  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      tenantId,
      contactId: contactId || null,
      leadId: null,
      status: 'running',
      inputData,
      startedAt: new Date(),
    })
    .returning({ id: workflowExecutions.id });

  if (!execution) throw new Error('Failed to create execution record');

  // Enrich context data
  const ctx: Record<string, unknown> = { ...inputData, contact_id: contactId, deal_id: dealId, tenant_id: tenantId, user_id: userId };

  // Load contact data if available
  if (contactId) {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (contact) {
      ctx.contact = contact;
      ctx.first_name = contact.firstName;
      ctx.last_name = contact.lastName;
      ctx.email = contact.email;
      ctx.phone = contact.phone;
      ctx.company_name = '';
      ctx.assigned_to = contact.assignedTo;
    }
  }

  // Load deal data if available
  if (dealId) {
    const [deal] = await db
      .select()
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1);
    if (deal) {
      ctx.deal = deal;
      ctx.deal_title = deal.title;
      ctx.deal_value = deal.amount;
      ctx.stage = '';
    }
  }

  try {
    // Parse nodes and edges from workflow
    const nodes = (workflow.nodes as WorkflowNode[]) || [];
    const edges = (workflow.edges as WorkflowEdge[]) || [];

    // Build adjacency map
    const children = new Map<string, { target: string; handle?: string }[]>();
    for (const edge of edges) {
      const list = children.get(edge.source) || [];
      list.push({ target: edge.target, handle: edge.sourceHandle });
      children.set(edge.source, list);
    }

    // Find trigger node (entry point)
    const triggerNode = nodes.find(n => n.type === 'trigger');
    if (!triggerNode) {
      await updateExecution(execution.id, 'failed', null, 'No trigger node found');
      return execution.id;
    }

    // Execute starting from trigger — wrap all DB writes in a transaction
    await db.transaction(async (tx) => {
      await executeNode(tx, triggerNode.id, nodes, children, execution.id, tenantId, userId, ctx);
      await updateExecution(tx, execution.id, 'completed', ctx);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    captureError(err, `workflow:${workflow.name}`);
    await db
      .update(workflowExecutions)
      .set({
        status: 'failed',
        errorMessage: message || null,
        completedAt: new Date(),
      })
      .where(eq(workflowExecutions.id, execution.id));
  }

  return execution.id;
}

async function executeNode(
  dbOrTx: NodePgDatabase | typeof db,
  nodeId: string,
  nodes: WorkflowNode[],
  children: Map<string, { target: string; handle?: string }[]>,
  executionId: string,
  tenantId: string,
  userId: string | undefined,
  ctx: Record<string, unknown>
): Promise<void> {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;

  // Log execution
  await dbOrTx.insert(workflowExecutionLogs).values({
    workflowExecutionId: executionId,
    tenantId,
    message: `Executing node: ${node.type} (${node.id})`,
    level: 'info',
    stepName: node.type,
  });

  // Handle different node types
  switch (node.type) {
    case 'trigger':
      // Trigger node is a no-op, just pass through
      break;

    case 'condition': {
      const { field, operator, value } = node.data as { field?: string; operator?: string; value?: unknown };
      if (!field) break;
      const fieldValue = getNestedValue(ctx, field);
      const conditionMet = evaluateCondition(fieldValue, operator || 'equals', value);
      if (!conditionMet) {
        // Don't proceed to children — condition not met
        return;
      }
      break;
    }

    case 'wait': {
      const { duration, unit } = node.data as { duration?: number; unit?: string };
      // In a real implementation, this would schedule the next nodes for later
      // For now, we log it and continue immediately
      await dbOrTx.insert(workflowExecutionLogs).values({
        workflowExecutionId: executionId,
        tenantId,
        message: `Wait step: ${duration} ${unit} (logged, not blocking)`,
        level: 'info',
        stepName: 'wait',
      });
      break;
    }

    default: {
      // Action nodes: action_send_email, action_create_task, etc.
      if (node.type.startsWith('action_')) {
        const actionType = node.type.replace('action_', '');
        await executeActionNode(dbOrTx, actionType, node.data, executionId, tenantId, userId, ctx);
      }
      break;
    }
  }

  // Proceed to children
  const childEdges = children.get(nodeId) || [];
  for (const edge of childEdges) {
    await executeNode(dbOrTx, edge.target, nodes, children, executionId, tenantId, userId, ctx);
  }
}

async function executeActionNode(
  dbOrTx: NodePgDatabase | typeof db,
  actionType: string,
  data: Record<string, unknown>,
  executionId: string,
  tenantId: string,
  userId: string | undefined,
  ctx: Record<string, unknown>
): Promise<void> {
  const actionLog = {
    executionId,
    tenantId,
    actionId: null as string | null,
    status: 'running' as string,
    startedAt: new Date(),
  };

  try {
    switch (actionType) {
      case 'send_email': {
        const to = (data.to as string) || (ctx.email as string);
        if (!to) throw new Error('No email recipient');
        await sendEmail({
          to,
          subject: interpolate((data.subject as string) || 'Message from NuCRM', ctx),
          html: interpolate((data.body as string) || '', ctx),
        });
        break;
      }

      case 'create_task': {
        const contactId = ctx.contact_id as string;
        await dbOrTx.insert(tasks).values({
          tenantId,
          title: interpolate((data.title as string) || 'Follow up', ctx),
          priority: (data.priority as string) || 'medium',
          contactId: contactId || null,
          dealId: (ctx.deal_id as string) || null,
          assignedTo: (data.assigned_to as string) || (ctx.user_id as string) || null,
          createdBy: userId || null,
          completed: false,
        });
        break;
      }

      case 'update_contact': {
        const contactId = ctx.contact_id as string;
        if (!contactId) break;
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (data.field && data.value) {
          updates[data.field as string] = data.value;
        }
        await dbOrTx.update(contacts).set(updates)
          .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
        break;
      }

      case 'add_tag': {
        const contactId = ctx.contact_id as string;
        const tag = data.tag as string;
        if (!contactId || !tag) break;
        const [existing] = await dbOrTx.select({ tags: contacts.tags })
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .limit(1);
        const currentTags = existing?.tags || [];
        if (!currentTags.includes(tag)) {
          await dbOrTx.update(contacts).set({ tags: [...currentTags, tag], updatedAt: new Date() })
            .where(eq(contacts.id, contactId));
        }
        break;
      }

      case 'send_notification': {
        const targetUserId = (data.user_id as string) || (ctx.user_id as string);
        if (!targetUserId) break;
        await createNotification({
          userId: targetUserId,
          tenantId,
          type: 'system',
          title: interpolate((data.title as string) || 'Workflow notification', ctx),
          body: data.body ? interpolate(data.body as string, ctx) : undefined,
          link: (data.link as string) || undefined,
        });
        break;
      }

      case 'fire_webhook': {
        const url = data.url as string;
        if (!url) break;
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'workflow.action',
            timestamp: new Date().toISOString(),
            tenant_id: tenantId,
            data: ctx,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        break;
      }

      case 'create_deal': {
        const stageId = data.stage_id as string;
        if (!stageId) throw new Error('stage_id required for create_deal');
        await dbOrTx.insert(deals).values({
          tenantId,
          title: interpolate((data.title as string) || 'New Deal', ctx),
          amount: (data.amount as string) || '0',
          pipelineId: (data.pipeline_id as string) || null,
          stageId,
          contactId: (ctx.contact_id as string) || null,
          companyId: (ctx.company_id as string) || null,
          assignedTo: (data.assigned_to as string) || (ctx.user_id as string) || null,
          createdBy: userId || null,
        });
        break;
      }

      case 'assign_contact': {
        const contactId = ctx.contact_id as string;
        const assignTo = (data.assigned_to as string) || (ctx.assigned_to as string);
        if (!contactId || !assignTo) break;
        await dbOrTx.update(contacts).set({ assignedTo: assignTo, updatedAt: new Date() })
          .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
        break;
      }

      case 'log_call': {
        const contactId = ctx.contact_id as string;
        if (!contactId) break;
        await dbOrTx.insert(callLogs).values({
          tenantId,
          contactId,
          userId: userId || null,
          direction: (data.direction as string) || 'outbound',
          duration: (data.duration as number) || 0,
          notes: interpolate((data.notes as string) || 'Call logged by workflow', ctx),
          phoneNumber: (data.phone_number as string) || (ctx.phone as string) || null,
        });
        break;
      }

      default:
        console.warn(`[workflow] Unknown action type: ${actionType}`);
    }

    actionLog.status = 'success';
  } catch (err: unknown) {
    actionLog.status = 'failed';
    const message = err instanceof Error ? err.message : String(err);
    await dbOrTx.insert(workflowExecutionLogs).values({
      workflowExecutionId: executionId,
      tenantId,
      message: `Action ${actionType} failed: ${message}`,
      level: 'info',
      stepName: actionType,
    });
  } finally {
    await dbOrTx.insert(workflowActionLogs).values({
      ...actionLog,
      completedAt: new Date(),
      result: { actionType, data },
    });
  }
}

async function updateExecution(
  dbOrTx: NodePgDatabase | typeof db,
  executionId: string,
  status: string,
  outputData: Record<string, unknown> | null,
  errorMessage?: string
): Promise<void> {
  await dbOrTx
    .update(workflowExecutions)
    .set({
      status,
      outputData: outputData || undefined,
      errorMessage: errorMessage || null,
      completedAt: new Date(),
    })
    .where(eq(workflowExecutions.id, executionId));
}

function evaluateCondition(fieldValue: unknown, operator: string, value: unknown): boolean {
  switch (operator) {
    case 'equals': return String(fieldValue) === String(value);
    case 'not_equals': return String(fieldValue) !== String(value);
    case 'contains': return String(fieldValue ?? '').includes(String(value));
    case 'not_contains': return !String(fieldValue ?? '').includes(String(value));
    case 'greater_than': return Number(fieldValue) > Number(value);
    case 'less_than': return Number(fieldValue) < Number(value);
    case 'is_empty': return fieldValue == null || fieldValue === '';
    case 'is_not_empty': return fieldValue != null && fieldValue !== '';
    default: return true;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}
