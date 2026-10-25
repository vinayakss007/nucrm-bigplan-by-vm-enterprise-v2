/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { eq, and, isNull } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/service';
import {
  evaluateCondition,
  getNestedValue,
  interpolate,
  interpolateHtml,
} from './workflow-values';
import { createNotification } from '@/lib/notifications';
import { captureError } from '@/lib/capture-error';
import { safeFetch } from '@/lib/security/ssrf';

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
 * All mutations are wrapped in a single transaction for atomicity.
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

  // Enrich context data
  const ctx: Record<string, unknown> = { ...inputData, contact_id: contactId, deal_id: dealId, tenant_id: tenantId, user_id: userId };

  // Load contact data if available.
  // SECURITY: scope by tenantId. contactId originates from the caller-supplied
  // trigger_entity_id (see app/api/tenant/workflows/[id]/run), so an id from
  // another tenant must never hydrate the context — otherwise send_email /
  // fire_webhook actions would exfiltrate cross-tenant PII.
  if (contactId) {
    const [contact] = await db
      .select()
      .from(contacts)
      // #3228 — this hydration is where `ctx.email` comes from, and `send_email` uses `ctx.email`
      // as its recipient, so every tenant workflow mailed a trashed contact on each trigger.
      .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId), isNull(contacts.deletedAt)))
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

  // Load deal data if available. SECURITY: scope by tenantId (see contact note above).
  if (dealId) {
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId), isNull(deals.deletedAt)))
      .limit(1);
    if (deal) {
      ctx.deal = deal;
      ctx.deal_title = deal.title;
      ctx.deal_value = deal.amount;
      ctx.stage = '';
    }
  }

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

  // Create execution record (outside transaction so failed attempts are never lost)
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

  try {
    // Actions that fail are caught inside executeActionNode so one bad node
    // cannot roll back the nodes behind it. The outcomes still have to reach
    // the status below, so the walk collects them (#3139).
    const actionFailures: string[] = [];

    // Wrap node execution + status update in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Find trigger node (entry point)
      const triggerNode = nodes.find(n => n.type === 'trigger');
      if (!triggerNode) {
        await updateExecution(tx, execution.id, 'failed', null, 'No trigger node found');
        return;
      }

      // Execute starting from trigger
      await executeNode(tx, triggerNode.id, nodes, children, execution.id, tenantId, userId, ctx, new Set(), actionFailures);

      // A run whose actions were all rejected by the provider, or that threw on
      // every node, used to be written as 'completed' — indistinguishable from a
      // run that did everything. 'failed' is already allowed by
      // chk_workflow_executions_status, so no migration is needed to report it.
      if (actionFailures.length > 0) {
        await updateExecution(
          tx,
          execution.id,
          'failed',
          ctx,
          `${actionFailures.length} action(s) failed: ${actionFailures.join('; ')}`.slice(0, 500),
        );
      } else {
        await updateExecution(tx, execution.id, 'completed', ctx);
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    captureError(err, `workflow:${workflow.name}`);
    try {
      await updateExecution(db, execution.id, 'failed', null, message);
    } catch (updateErr) {
      captureError(updateErr, 'workflow:execution-status-update');
    }
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
  ctx: Record<string, unknown>,
  visited: Set<string>,
  actionFailures: string[]
): Promise<void> {
  // Cycle detection: skip nodes already visited in this execution path.
  // NOTE: The visited Set serves as both cycle prevention AND deduplication.
  // In DAG workflows with fan-in (multiple branches converging on the same node),
  // a shared node will only execute once per workflow run -- whichever branch
  // reaches it first. This is intentional: each workflow execution produces
  // exactly one invocation per node, avoiding duplicate side-effects (e.g.,
  // sending the same email twice). If per-path execution is needed in the future,
  // use a recursion-stack approach instead of a global visited set.
  if (visited.has(nodeId)) return;
  visited.add(nodeId);

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
      // Convert duration to milliseconds based on the unit
      let delayMs = 0;
      if (typeof duration === 'number' && duration > 0) {
        switch ((unit || 'minutes').toLowerCase()) {
          case 'seconds': delayMs = duration * 1000; break;
          case 'hours': delayMs = duration * 3_600_000; break;
          case 'days': delayMs = duration * 86_400_000; break;
          default: delayMs = duration * 60_000; break;
        }
      }
      // Cap at 60s: this executor runs inline inside a request/serverless
      // context, so blocking longer than that is not viable.
      const MAX_WAIT_MS = 60_000;
      const capped = delayMs > MAX_WAIT_MS;
      const effectiveDelayMs = Math.min(delayMs, MAX_WAIT_MS);
      if (effectiveDelayMs > 0) {
        await dbOrTx.insert(workflowExecutionLogs).values({
          workflowExecutionId: executionId,
          tenantId,
          message: capped
            ? `Wait step: ${duration} ${unit} exceeds 60s cap — waiting 60s instead`
            : `Wait step: waiting ${effectiveDelayMs / 1000}s`,
          level: capped ? 'warn' : 'info',
          stepName: 'wait',
        });
        await new Promise(r => setTimeout(r, effectiveDelayMs));
      }
      break;
    }

    default: {
      // Action nodes: action_send_email, action_create_task, etc.
      if (node.type.startsWith('action_')) {
        const actionType = node.type.replace('action_', '');
        await executeActionNode(dbOrTx, actionType, node.data, executionId, tenantId, userId, ctx, actionFailures);
      }
      break;
    }
  }

  // Proceed to children
  const childEdges = children.get(nodeId) || [];
  for (const edge of childEdges) {
    await executeNode(dbOrTx, edge.target, nodes, children, executionId, tenantId, userId, ctx, visited, actionFailures);
  }
}

async function executeActionNode(
  dbOrTx: NodePgDatabase | typeof db,
  actionType: string,
  data: Record<string, unknown>,
  executionId: string,
  tenantId: string,
  userId: string | undefined,
  ctx: Record<string, unknown>,
  actionFailures: string[]
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
        // #3131: a provider 4xx/5xx resolves `{ success: false, error }` instead
        // of throwing (#2422/#3045), so this has to be read or the action log
        // claims a delivery that never happened. This catch is below: the action
        // fails and the walk continues, like the no-recipient case above.
        const sent = await sendEmail({
          to,
          subject: interpolate((data.subject as string) || 'Message from NuCRM', ctx),
          html: interpolateHtml((data.body as string) || '', ctx),
        });
        if (!sent.success) throw new Error(sent.error ?? 'email provider rejected the automated send');
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
          .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId), isNull(contacts.deletedAt)))
          .limit(1);
        const currentTags = existing?.tags || [];
        if (!currentTags.includes(tag)) {
          await dbOrTx.update(contacts).set({ tags: [...currentTags, tag], updatedAt: new Date() })
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)));
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
        await safeFetch(url, {
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
    // Recorded before the log write so a failing insert cannot erase the fact
    // that this action did not happen.
    actionFailures.push(`${actionType}: ${message}`);
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
