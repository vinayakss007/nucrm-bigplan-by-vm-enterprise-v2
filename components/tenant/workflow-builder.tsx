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
  Plus, Save, Play, Trash2, Settings2, Mail, Bell, Users, Calendar,
  TrendingUp, Zap, Tag, Phone, Clock, FileText, DollarSign, GitBranch,
  ArrowRight, Loader2, X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'

// ─── Custom Node Data Type ─────────────────────────────────────────────────────

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  description?: string;
  config: Record<string, any>;
  configPreview?: string;
}

type CustomNode = Node<CustomNodeData>

// ─── Node Type Definitions ─────────────────────────────────────────────────────

const NODE_TYPES = {
  trigger: 'trigger',
  action_send_email: 'action_send_email',
  action_create_task: 'action_create_task',
  action_update_contact: 'action_update_contact',
  action_add_tag: 'action_add_tag',
  action_send_notification: 'action_send_notification',
  action_fire_webhook: 'action_fire_webhook',
  action_create_deal: 'action_create_deal',
  action_assign_contact: 'action_assign_contact',
  condition: 'condition',
  wait: 'wait',
}

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

const TRIGGER_OPTIONS = [
  { value: 'contact.created', label: 'Contact Created' },
  { value: 'contact.updated', label: 'Contact Updated' },
  { value: 'deal.created', label: 'Deal Created' },
  { value: 'deal.stage_changed', label: 'Deal Stage Changed' },
  { value: 'deal.won', label: 'Deal Won' },
  { value: 'deal.lost', label: 'Deal Lost' },
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.completed', label: 'Task Completed' },
  { value: 'form.submitted', label: 'Form Submitted' },
]

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
  const [triggerType, setTriggerType] = useState('contact.created')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showPalette, setShowPalette] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [nodeConfig, setNodeConfig] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(!!workflowId)

  // Load existing workflow
  useEffect(() => {
    if (!workflowId) {
      // Create initial trigger node
      const triggerNode: CustomNode = {
        id: 'trigger-1',
        type: 'workflowNode',
        position: { x: 400, y: 50 },
        data: { label: 'Trigger', nodeType: 'trigger', description: TRIGGER_OPTIONS[0]?.label, config: {} },
      }
      setNodes([triggerNode])
      setLoading(false)
      return
    }

    const loadWorkflow = async () => {
      try {
        const res = await fetch(`/api/tenant/workflows/${workflowId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        const wf = data.data
        setWorkflowName(wf.name)
        setWorkflowDescription(wf.description || '')
        setTriggerType(wf.trigger_type)

        // Load nodes from JSONB or create from actions
        if (wf.nodes && Array.isArray(wf.nodes) && wf.nodes.length > 0) {
          setNodes(wf.nodes)
        } else if (wf.actions && wf.actions.length > 0) {
          // Convert actions to nodes
          const actionNodes: CustomNode[] = wf.actions.map((action: any, i: number) => ({
            id: `action-${i + 1}`,
            type: 'workflowNode',
            position: { x: 400, y: 200 + i * 180 },
            data: {
              label: action.action_type.replace('action_', '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              nodeType: `action_${action.action_type}`,
              config: action.action_config,
            },
          }))
          const triggerNode: CustomNode = {
            id: 'trigger-1',
            type: 'workflowNode',
            position: { x: 400, y: 50 },
            data: { label: 'Trigger', nodeType: 'trigger', description: TRIGGER_OPTIONS.find(t => t.value === wf.trigger_type)?.label, config: {} },
          }
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
          const triggerNode: CustomNode = {
            id: 'trigger-1',
            type: 'workflowNode',
            position: { x: 400, y: 50 },
            data: { label: 'Trigger', nodeType: 'trigger', description: TRIGGER_OPTIONS.find(t => t.value === wf.trigger_type)?.label, config: {} },
          }
          setNodes([triggerNode])
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }

    loadWorkflow()
  }, [workflowId])

  const onConnect: OnConnect = useCallback(
    (connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds))
    },
    [setEdges]
  )

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

    setNodes((nds) => [...nds, newNode])
  }

  const deleteNode = (nodeId: string) => {
    setNodes((nds) => nds.filter(n => n.id !== nodeId))
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
        .map((node, index) => ({
          action_type: node.data['nodeType'].replace('action_', ''),
          action_config: node.data['config'] || {},
          condition_type: node.data['nodeType'] === 'condition' ? 'if' : 'always',
          condition_config: {},
        }))

      const body: any = {
        name: workflowName.trim(),
        description: workflowDescription,
        trigger_type: triggerType,
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to save workflow')
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
          trigger_entity_type: triggerType.split('.')[0],
          trigger_entity_id: '', // Will be filled in by user in a modal
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Test execution started: ${data.execution_id}`)
    } catch (err: any) {
      toast.error(err.message || 'Test failed')
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
            value={triggerType}
            onChange={e => {
              setTriggerType(e.target.value)
              // Update trigger node description
              setNodes(nds => nds.map(n =>
                n.data.nodeType === 'trigger'
                  ? { ...n, data: { ...n.data, description: TRIGGER_OPTIONS.find(t => t.value === e.target.value)?.label } }
                  : n
              ))
            }}
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {TRIGGER_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
                const palette = NODE_PALETTE.find(p => p.type === node.data.nodeType)
                const cfg = node.data.config as any

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
