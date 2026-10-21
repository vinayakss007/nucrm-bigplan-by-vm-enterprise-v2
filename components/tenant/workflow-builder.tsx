/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client'

import { useCallback, useState, useEffect } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  Panel,
  BackgroundVariant,
  Handle,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Plus, Save, Play, Trash2, Mail, Bell, Users, Calendar, Zap, Tag, Clock, DollarSign, GitBranch, Loader2, X, Undo2, Redo2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import toast from 'react-hot-toast'
import { useUndoRedo } from './use-undo-redo'
import {
  DEFAULT_TRIGGER_EVENT,
  TRIGGER_KIND_LABELS,
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_TRIGGER_TYPES,
  isWorkflowTriggerType,
  triggerDescription,
  triggerEventFromConfig,
  type WorkflowTriggerType,
} from '@/lib/automation/workflow-trigger'

// ─── Custom Node Data Type ─────────────────────────────────────────────────────

/** Free-form node configuration. Keys/shape vary per node type, so values are
 *  `unknown` — read sites narrow before use (replaces the former `any`, #1268). */
type WorkflowConfig = Record<string, unknown>;

/** A persisted `workflowActions` row, as `GET /api/tenant/workflows/[id]` hands
 *  back the `db.query` result untouched (`[id]/route.ts:46`, `:58-64`): drizzle's
 *  TypeScript names. The snake_case SQL names belong to the request side, which
 *  is what `POST`/`PATCH` destructure (#2805). */
interface WorkflowActionRow {
  actionType: string;
  config?: WorkflowConfig | null;
}

/** The `data` of that response: a `workflows` row spread with its two lists.
 *  `triggerType` is the kind (`chk_workflows_trigger_type`) and the event, when
 *  the kind is `event`, lives in `triggerConfig` as `{ entity, event }` (#2806 (a)). */
interface WorkflowResponse {
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig?: WorkflowConfig | null;
  nodes?: unknown[];
  actions?: WorkflowActionRow[];
}

/** Narrow an unknown thrown value to a display message (replaces `catch (e: any)`). */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  description?: string;
  config: WorkflowConfig;
  configPreview?: string;
}

type CustomNode = Node<CustomNodeData>

// ─── Node Type Definitions ─────────────────────────────────────────────────────
// A node's `type` is its palette key; NODE_PALETTE is the only list of them. A
// parallel const map of the same strings was dead code and is gone (#2805).

const NODE_PALETTE = [
  { type: 'trigger', label: 'Trigger', icon: Zap, color: 'bg-violet-500', textColor: 'text-violet-600', bgColor: 'bg-violet-50 dark:bg-violet-950/30', borderColor: 'border-violet-300 dark:border-violet-700' },
  { type: 'action_send_email', label: 'Send Email', icon: Mail, color: 'bg-blue-500', textColor: 'text-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-950/30', borderColor: 'border-blue-300 dark:border-blue-700' },
  { type: 'action_create_task', label: 'Create Task', icon: Calendar, color: 'bg-emerald-500', textColor: 'text-emerald-600', bgColor: 'bg-emerald-50 dark:bg-emerald-950/30', borderColor: 'border-emerald-300 dark:border-emerald-700' },
  { type: 'action_send_notification', label: 'Notify', icon: Bell, color: 'bg-amber-500', textColor: 'text-amber-600', bgColor: 'bg-amber-50 dark:bg-amber-950/30', borderColor: 'border-amber-300 dark:border-amber-700' },
  { type: 'action_update_contact', label: 'Update Contact', icon: Users, color: 'bg-cyan-500', textColor: 'text-cyan-600', bgColor: 'bg-cyan-50 dark:bg-cyan-950/30', borderColor: 'border-cyan-300 dark:border-cyan-700' },
  { type: 'action_add_tag', label: 'Add Tag', icon: Tag, color: 'bg-pink-500', textColor: 'text-pink-600', bgColor: 'bg-pink-50 dark:bg-pink-950/30', borderColor: 'border-pink-300 dark:border-pink-700' },
  { type: 'action_create_deal', label: 'Create Deal', icon: DollarSign, color: 'bg-indigo-500', textColor: 'text-indigo-600', bgColor: 'bg-indigo-50 dark:bg-indigo-950/30', borderColor: 'border-indigo-300 dark:border-indigo-700' },
  { type: 'action_fire_webhook', label: 'Fire Webhook', icon: GitBranch, color: 'bg-orange-500', textColor: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-950/30', borderColor: 'border-orange-300 dark:border-orange-700' },
  { type: 'condition', label: 'Condition', icon: GitBranch, color: 'bg-yellow-500', textColor: 'text-yellow-600', bgColor: 'bg-yellow-50 dark:bg-yellow-950/30', borderColor: 'border-yellow-300 dark:border-yellow-700' },
  { type: 'wait', label: 'Wait', icon: Clock, color: 'bg-slate-500', textColor: 'text-slate-600', bgColor: 'bg-slate-50 dark:bg-slate-950/30', borderColor: 'border-slate-300 dark:border-slate-700' },
]

// The trigger vocabulary is #2806's decision, kept in one client-safe module so
// the builder, the API routes, and the drift test read the same lists.
// `trigger_type` holds the KIND; the event name (entity + event) goes to
// `trigger_config`. The former local TRIGGER_OPTIONS posted dotted values into
// `trigger_type`, which `chk_workflows_trigger_type` rejects — that is why no
// workflow could ever be created from this page.

// ─── Custom Node Component ─────────────────────────────────────────────────────

function WorkflowNode({ data, selected }: { data: CustomNodeData; selected: boolean }) {
  const palette = NODE_PALETTE.find(p => p.type === data.nodeType) || NODE_PALETTE[0]!
  const Icon = palette.icon

  return (
    <div className={cn(
      'rounded-xl border-2 px-4 py-3 min-w-[200px] shadow-sm transition-all relative group',
      palette.bgColor,
      palette.borderColor,
      selected && 'ring-2 ring-violet-500 ring-offset-2 shadow-lg'
    )}>
      {/* Input Handle (not for triggers) */}
      {data.nodeType !== 'trigger' && (
        <Handle 
          type="target" 
          position={Position.Top} 
          className="w-3 h-3 bg-violet-500 border-2 border-white dark:border-slate-900" 
        />
      )}

      <div className="flex items-center gap-2">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', palette.color)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{data.label}</p>
          {data.description && <p className="text-xs text-muted-foreground truncate">{data.description}</p>}
        </div>
      </div>
      {data.configPreview && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">{data.configPreview}</p>
        </div>
      )}

      {/* Output Handle */}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="w-3 h-3 bg-violet-500 border-2 border-white dark:border-slate-900" 
      />
    </div>
  )
}

const nodeTypes = {
  workflowNode: WorkflowNode,
}

// ─── Main Builder Component ────────────────────────────────────────────────────

interface Props {
  workflowId?: string
  onSave?: () => void
}

export default function WorkflowBuilder({ workflowId, onSave }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [workflowName, setWorkflowName] = useState('New Workflow')
  const [workflowDescription, setWorkflowDescription] = useState('')
  // #2806 (a): triggerType is the KIND — one of chk_workflows_trigger_type's
  // four — and the dotted event the old single select held moves to
  // trigger_config as { entity, event }.
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('event')
  const [triggerEvent, setTriggerEvent] = useState<string>(DEFAULT_TRIGGER_EVENT)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPalette, setShowPalette] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [_nodeConfig] = useState<WorkflowConfig>({})
  const [loading, setLoading] = useState(!!workflowId)

  // Undo/Redo
  const { canUndo, canRedo, pushState, undo, redo, reset } = useUndoRedo([], [])

  const makeTriggerNode = (description?: string): CustomNode => ({
    id: 'trigger-1',
    type: 'workflowNode',
    position: { x: 400, y: 50 },
    data: { label: 'Trigger', nodeType: 'trigger', description, config: {} },
  })

  // Keep the canvas trigger node's caption in step with the two pickers.
  const updateTriggerNode = (kind: string, event: string) =>
    setNodes(nds => nds.map(n =>
      n.data.nodeType === 'trigger'
        ? { ...n, data: { ...n.data, description: triggerDescription(kind, event) } }
        : n
    ))

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Z = undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const prev = undo();
        if (prev) {
          setNodes(prev.nodes as CustomNode[]);
          setEdges(prev.edges);
        }
      }
      // Ctrl/Cmd + Shift + Z = redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        const next = redo();
        if (next) {
          setNodes(next.nodes as CustomNode[]);
          setEdges(next.edges);
        }
      }
      // Ctrl/Cmd + Y = redo (alternative)
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        const next = redo();
        if (next) {
          setNodes(next.nodes as CustomNode[]);
          setEdges(next.edges);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setNodes, setEdges]);

  // Load existing workflow
  useEffect(() => {
    if (!workflowId) {
      // Create initial trigger node
      const triggerNode = makeTriggerNode(triggerDescription('event', DEFAULT_TRIGGER_EVENT))
      setNodes([triggerNode])
      reset([triggerNode], [])
      setLoading(false)
      return
    }

    const abort = new AbortController();

    const loadWorkflow = async () => {
      try {
        const res = await fetch(`/api/tenant/workflows/${workflowId}`, { signal: abort.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        const wf = data.data as WorkflowResponse
        setWorkflowName(wf.name)
        setWorkflowDescription(wf.description || '')
        // chk_workflows_trigger_type is only satisfied by the four kinds, so a
        // legacy row that still carries a dotted event name is not a legal kind
        // — fall back to `event` and let the stored config supply the pair.
        if (isWorkflowTriggerType(wf.triggerType)) {
          setTriggerType(wf.triggerType)
        } else {
          setTriggerType('event')
        }
        const storedEvent = triggerEventFromConfig(wf.triggerConfig)
        if (storedEvent) setTriggerEvent(storedEvent)

        // Load nodes from JSONB or create from actions
        if (wf.nodes && Array.isArray(wf.nodes) && wf.nodes.length > 0) {
          setNodes(wf.nodes as CustomNode[])
        } else if (wf.actions && wf.actions.length > 0) {
          // Convert actions to nodes
          const actionNodes: CustomNode[] = wf.actions.map((action: WorkflowActionRow, i: number) => ({
            id: `action-${i + 1}`,
            type: 'workflowNode',
            position: { x: 400, y: 200 + i * 180 },
            data: {
              label: action.actionType.replace('action_', '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              nodeType: `action_${action.actionType}`,
              config: action.config ?? {},
            },
          }))
          const triggerNode = makeTriggerNode(triggerDescription(wf.triggerType, triggerEventFromConfig(wf.triggerConfig)))
          setNodes([triggerNode, ...actionNodes])

          // Create edges connecting all nodes in sequence
          const allNodes = [triggerNode, ...actionNodes]
          const newEdges: Edge[] = allNodes.slice(0, -1).map((node, i) => ({
            id: `edge-${node.id}-${allNodes[i + 1]!.id}`,
            source: node.id,
            target: allNodes[i + 1]!.id,
            animated: true,
          }))
          setEdges(newEdges)
        } else {
          const triggerNode = makeTriggerNode(triggerDescription(wf.triggerType, triggerEventFromConfig(wf.triggerConfig)))
          setNodes([triggerNode])
        }
      } catch (err: unknown) {
        toast.error(errorMessage(err, 'Failed to load workflow'))
      } finally {
        setLoading(false)
      }
    }

    loadWorkflow()
    return () => abort.abort()
  }, [workflowId, setNodes, setEdges, reset])

  const onConnect: OnConnect = useCallback(
    (connection) => {
      setEdges((eds) => {
        const newEdges = addEdge({ ...connection, animated: true }, eds);
        // Push to history after state updates
        setTimeout(() => pushState(nodes, newEdges), 0);
        return newEdges;
      });
    },
    [setEdges, nodes, pushState]
  )

  // Wrapped node/edge change handlers that push to undo history
  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Push to history on structural changes (add/remove)
      setTimeout(() => {
        const hasStructural = changes.some(c => c.type === 'add' || c.type === 'remove');
        if (hasStructural) pushState(nodes, edges);
      }, 0);
    },
    [onNodesChange, nodes, edges, pushState]
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      setTimeout(() => {
        const hasStructural = changes.some(c => c.type === 'remove');
        if (hasStructural) pushState(nodes, edges);
      }, 0);
    },
    [onEdgesChange, nodes, edges, pushState]
  );

  const addNode = (nodeType: string) => {
    const palette = NODE_PALETTE.find(p => p.type === nodeType)
    if (!palette) return

    const lastNode = nodes[nodes.length - 1]
    const newY = lastNode ? lastNode.position.y + 180 : 200

    const newNode: CustomNode = {
      id: `${nodeType}-${Date.now()}`,
      type: 'workflowNode',
      position: { x: lastNode?.position.x ?? 400, y: newY },
      data: {
        label: palette.label,
        nodeType,
        description: '',
        config: {},
      },
    }

    setNodes((nds) => {
      const newNodes = [...nds, newNode];
      setTimeout(() => pushState(newNodes, edges), 0);
      return newNodes;
    });
  }

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => {
      const newNodes = nds.filter(n => n.id !== nodeId);
      setTimeout(() => {
        const newEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        setEdges(newEdges);
        pushState(newNodes, newEdges);
      }, 0);
      return newNodes;
    });
    setEdges((eds) => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
    if (selectedNode === nodeId) setSelectedNode(null)
  }

  const saveWorkflow = async () => {
    if (!workflowName.trim()) {
      toast.error('Workflow name is required')
      return
    }

    setSaving(true)
    try {
      const method = workflowId ? 'PATCH' : 'POST'
      const url = workflowId ? `/api/tenant/workflows/${workflowId}` : '/api/tenant/workflows'

      // Build actions from nodes and edges (topological order)
      const sortedNodes = nodes.sort((a, b) => a.position.y - b.position.y)
      const actions = sortedNodes
        .filter(n => n.data['nodeType'] !== 'trigger')
        .map((node, _index) => ({
          action_type: node.data['nodeType'].replace('action_', ''),
          action_config: node.data['config'] || {},
          condition_type: node.data['nodeType'] === 'condition' ? 'if' : 'always',
          condition_config: {},
        }))

      // #2806 (a): trigger_type carries the kind and the event pair rides in
      // trigger_config. For the non-event kinds the builder owns no config, so
      // it is left out of the payload and PATCH leaves the stored value alone.
      const [triggerEntity = '', triggerEventName = ''] = triggerEvent.split('.')
      const body: {
        name: string;
        description: string;
        trigger_type: string;
        trigger_config?: { entity: string; event: string };
        nodes: CustomNode[];
        actions?: typeof actions;
      } = {
        name: workflowName.trim(),
        description: workflowDescription,
        trigger_type: triggerType,
        ...(triggerType === 'event' ? { trigger_config: { entity: triggerEntity, event: triggerEventName } } : {}),
        nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
      }

      if (actions.length > 0) {
        body.actions = actions
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast.success(workflowId ? 'Workflow updated' : 'Workflow created')
      onSave?.()
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Failed to save workflow'))
    } finally {
      setSaving(false)
    }
  }

  const testWorkflow = async () => {
    if (!workflowId) {
      toast.error('Save the workflow first before testing')
      return
    }

    setTesting(true)
    try {
      const res = await fetch(`/api/tenant/workflows/${workflowId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // #2806 (a): for an event trigger the test payload names the entity
          // from the stored pair; other kinds name the kind itself. No entity
          // id is sent until the builder grows a picker — the /test route
          // treats the entity as optional and runs the graph empty.
          trigger_entity_type: triggerType === 'event' ? triggerEvent.split('.')[0] : triggerType,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Test execution started: ${data.execution_id}`)
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Test failed'))
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3 flex-1">
          <input
            value={workflowName}
            onChange={e => setWorkflowName(e.target.value)}
            className="text-lg font-bold bg-transparent focus:outline-none focus:ring-2 focus:ring-violet-500 rounded px-2 py-1"
            placeholder="Workflow name"
          />
          <select
            aria-label="Trigger kind"
            value={triggerType}
            onChange={e => {
              if (!isWorkflowTriggerType(e.target.value)) return
              setTriggerType(e.target.value)
              updateTriggerNode(e.target.value, triggerEvent)
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {WORKFLOW_TRIGGER_TYPES.map(kind => (
              <option key={kind} value={kind}>{TRIGGER_KIND_LABELS[kind]}</option>
            ))}
          </select>
          {triggerType === 'event' && (
            <select
              aria-label="Trigger event"
              value={triggerEvent}
              onChange={e => {
                setTriggerEvent(e.target.value)
                updateTriggerNode(triggerType, e.target.value)
              }}
              className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {/* A stored event the palette no longer offers must still render,
                  or the select would silently display the first option. */}
              {!WORKFLOW_TRIGGER_EVENTS.some(t => `${t.entity}.${t.event}` === triggerEvent) && (
                <option value={triggerEvent}>{triggerEvent}</option>
              )}
              {WORKFLOW_TRIGGER_EVENTS.map(({ entity, event, label }) => (
                <option key={`${entity}.${event}`} value={`${entity}.${event}`}>{label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 mr-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const prev = undo();
                if (prev) {
                  setNodes(prev.nodes as CustomNode[]);
                  setEdges(prev.edges);
                }
              }}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const next = redo();
                if (next) {
                  setNodes(next.nodes as CustomNode[]);
                  setEdges(next.edges);
                }
              }}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPalette(p => !p)}
          >
            <Plus className="w-4 h-4 mr-1" />
            {showPalette ? 'Hide' : 'Show'} Palette
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={testWorkflow}
            disabled={testing || !workflowId}
          >
            {testing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
            Test
          </Button>
          <Button
            size="sm"
            onClick={saveWorkflow}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Palette Sidebar */}
        {showPalette && (
          <div className="w-56 border-r border-border bg-card overflow-y-auto">
            <div className="p-3">
              <h3 className="text-sm font-semibold mb-3">Node Palette</h3>
              <div className="space-y-1.5">
                {NODE_PALETTE.map(palette => {
                  const Icon = palette.icon
                  return (
                    <button
                      key={palette.type}
                      onClick={() => addNode(palette.type)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        palette.bgColor,
                        'hover:shadow-md'
                      )}
                    >
                      <div className={cn('w-6 h-6 rounded-md flex items-center justify-center', palette.color)}>
                        <Icon className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span>{palette.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            minZoom={0.2}
            maxZoom={1.5}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            onNodeClick={(_, node) => setSelectedNode(node.id)}
          >
            <Controls />
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
            
            <Panel position="top-left" className="bg-card/80 backdrop-blur-sm border border-border rounded-xl shadow-xl p-4 max-w-[220px] pointer-events-none mt-2 ml-2">
              <h4 className="text-xs font-bold uppercase tracking-widest text-violet-600 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4"/>
                Workflow Guide
              </h4>
              <ul className="space-y-3">
                <li className="text-[11px] text-muted-foreground flex gap-2.5 items-start">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Add blocks from the <b>Palette</b> on the left.</span>
                </li>
                <li className="text-[11px] text-muted-foreground flex gap-2.5 items-start">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Connect blocks by dragging between the <b>purple dots</b>.</span>
                </li>
                <li className="text-[11px] text-muted-foreground flex gap-2.5 items-start">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center text-[10px] font-bold">3</span>
                  <span>Click any block to <b>Configure</b> its specific settings.</span>
                </li>
              </ul>
            </Panel>

            <Panel position="top-right">
              <div className="bg-card border border-border rounded-lg shadow-lg p-2">
                <p className="text-xs font-medium text-muted-foreground px-2 pb-1">
                  {nodes.length} nodes · {edges.length} connections
                </p>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Node Config Panel */}
        {selectedNode && (
          <div className="w-72 border-l border-border bg-card overflow-y-auto">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Node Config</h3>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteNode(selectedNode)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedNode(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {(() => {
                const node = nodes.find(n => n.id === selectedNode)
                if (!node) return null
                const _palette = NODE_PALETTE.find(p => p.type === node.data.nodeType)
                // The config editor only reads/writes primitive fields; view the
                // untyped config through a record of optional primitives (#1268).
                const cfg = node.data.config as Record<string, string | number | undefined>

                return (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Label</label>
                      <input
                        value={node.data.label}
                        onChange={e => setNodes(nds => nds.map(n =>
                          n.id === selectedNode ? { ...n, data: { ...n.data, label: e.target.value } } : n
                        ))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>

                    {node.data.nodeType === 'action_send_email' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
                          <input
                            value={cfg?.subject || ''}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, subject: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            placeholder="Use {{first_name}} for variables"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
                          <textarea
                            value={cfg?.body || ''}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, body: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            rows={4}
                            placeholder="Email body content"
                          />
                        </div>
                      </>
                    )}

                    {node.data.nodeType === 'action_create_task' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Task Title</label>
                          <input
                            value={cfg?.title || ''}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, title: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            placeholder="Follow up with contact"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
                          <select
                            value={cfg?.priority || 'medium'}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, priority: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </div>
                      </>
                    )}

                    {node.data.nodeType === 'action_send_notification' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
                          <input
                            value={cfg?.title || ''}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, title: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
                          <textarea
                            value={cfg?.body || ''}
                            onChange={e => setNodes(nds => nds.map(n =>
                              n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, body: e.target.value } } } : n
                            ))}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            rows={3}
                          />
                        </div>
                      </>
                    )}

                    {node.data.nodeType === 'action_add_tag' && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Tag Name</label>
                        <input
                          value={cfg?.tag || ''}
                          onChange={e => setNodes(nds => nds.map(n =>
                            n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, tag: e.target.value } } } : n
                          ))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          placeholder="tag-name"
                        />
                      </div>
                    )}

                    {node.data.nodeType === 'action_fire_webhook' && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Webhook URL</label>
                        <input
                          value={cfg?.url || ''}
                          onChange={e => setNodes(nds => nds.map(n =>
                            n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, url: e.target.value } } } : n
                          ))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          placeholder="https://example.com/webhook"
                        />
                      </div>
                    )}

                    {node.data.nodeType === 'wait' && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Wait (seconds)</label>
                        <input
                          type="number"
                          value={cfg?.seconds || 60}
                          onChange={e => setNodes(nds => nds.map(n =>
                            n.id === selectedNode ? { ...n, data: { ...n.data, config: { ...n.data.config, seconds: parseInt(e.target.value) } } } : n
                          ))}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                    )}

                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground">
                        Variables: <code className="bg-muted px-1 rounded">{'{{first_name}}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{{email}}'}</code>{' '}
                        <code className="bg-muted px-1 rounded">{'{{company}}'}</code>
                      </p>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
