"use client"

import { useState } from 'react'
import { Mail, Calendar, Clock, Phone, Trash2, Users, GripVertical, FlaskConical, Split } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import toast from 'react-hot-toast'

interface SequenceStep {
  id?: string
  step_number: number
  type: 'email' | 'task' | 'wait' | 'call' | 'ab_test'
  subject?: string
  body?: string
  delay_days?: number
  delay_hours?: number
  task_title?: string
  task_description?: string
  call_script?: string
  ab_variant?: 'a' | 'b'
  ab_subject_a?: string
  ab_body_a?: string
  ab_subject_b?: string
  ab_body_b?: string
}

interface Sequence {
  id: string
  name: string
  description: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  total_steps: number
  total_duration_days: number
  steps: SequenceStep[]
}

interface SequenceBuilderProps {
  sequence?: Sequence
  onSave: (sequence: Partial<Sequence>) => Promise<void>
  onCancel: () => void
}

const STEP_TYPES = [
  { value: 'email', label: 'Email', icon: Mail, color: 'text-blue-600' },
  { value: 'task', label: 'Task', icon: Calendar, color: 'text-violet-600' },
  { value: 'wait', label: 'Wait', icon: Clock, color: 'text-amber-600' },
  { value: 'call', label: 'Call', icon: Phone, color: 'text-green-600' },
  { value: 'ab_test', label: 'A/B Test', icon: Split, color: 'text-rose-600' },
]

export function SequenceBuilder({ sequence, onSave, onCancel }: SequenceBuilderProps) {
  const [name, setName] = useState(sequence?.name || '')
  const [description, setDescription] = useState(sequence?.description || '')
  const [steps, setSteps] = useState<SequenceStep[]>(sequence?.steps || [])
  const [saving, setSaving] = useState(false)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const addStep = (type: SequenceStep['type']) => {
    const newStep: SequenceStep = {
      step_number: steps.length + 1,
      type,
      delay_days: type === 'wait' ? 1 : 0,
      delay_hours: type === 'email' ? 9 : 0,
      subject: type === 'email' ? '' : undefined,
      body: type === 'email' ? '' : undefined,
      task_title: type === 'task' ? '' : undefined,
      task_description: type === 'task' ? '' : undefined,
      call_script: type === 'call' ? '' : undefined,
      ab_subject_a: type === 'ab_test' ? '' : undefined,
      ab_body_a: type === 'ab_test' ? '' : undefined,
      ab_subject_b: type === 'ab_test' ? '' : undefined,
      ab_body_b: type === 'ab_test' ? '' : undefined,
    }
    setSteps([...steps, newStep])
    setExpandedStep(steps.length)
  }

  const updateStep = (index: number, updates: Partial<SequenceStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index]!, ...updates }
    setSteps(newSteps)
  }

  const deleteStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index)
    newSteps.forEach((step, i) => { step.step_number = i + 1 })
    setSteps(newSteps)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = steps.findIndex((_, i) => String(i) === String(active.id))
    const newIndex = steps.findIndex((_, i) => String(i) === String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newSteps = arrayMove(steps, oldIndex, newIndex)
    newSteps.forEach((step, i) => { step.step_number = i + 1 })
    setSteps(newSteps)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Sequence name is required')
      return
    }
    if (steps.length === 0) {
      toast.error('At least one step is required')
      return
    }

    setSaving(true)
    try {
      await onSave({
        name,
        description,
        steps,
        total_steps: steps.length,
        total_duration_days: Math.ceil(
          steps.reduce((sum, step) => 
            sum + (step.delay_days || 0) + (step.delay_hours || 0) / 24, 0
          )
        ),
      })
      toast.success('Sequence saved!')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      toast.error(error.message || 'Failed to save sequence')
    }
    setSaving(false)
  }

  const calculateTotalDuration = () => {
    const days = steps.reduce((sum, step) => 
      sum + (step.delay_days || 0) + (step.delay_hours || 0) / 24, 0
    )
    if (days < 1) return '< 1 day'
    if (days < 7) return `${days.toFixed(1)} days`
    if (days < 30) return `${(days / 7).toFixed(1)} weeks`
    return `${(days / 30).toFixed(1)} months`
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            {sequence ? 'Edit Sequence' : 'Create Sequence'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Build multi-step drip campaigns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Sequence'}
          </Button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="admin-card p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Sequence Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., New Lead Outreach"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the purpose of this sequence"
          />
        </div>
        {steps.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>Duration: <strong>{calculateTotalDuration()}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>Steps: <strong>{steps.length}</strong></span>
            </div>
          </div>
        )}
      </div>

      {/* Steps Timeline */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Sequence Steps</h3>
          <div className="flex items-center gap-2">
            {STEP_TYPES.map(({ value, label, icon: Icon, color }) => (
              <Button
                key={value}
                variant="outline"
                size="sm"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={() => addStep(value as any)}
                className="text-xs"
              >
                <Icon className={cn('w-3.5 h-3.5 mr-1.5', color)} />
                {label}
              </Button>
            ))}
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="admin-card p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-semibold mb-1">No steps yet</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first step to start building the sequence
            </p>
            <div className="flex items-center justify-center gap-2">
              {STEP_TYPES.map(({ value, label, icon: Icon, color }) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={() => addStep(value as any)}
                  className="text-xs"
                >
                  <Icon className={cn('w-3.5 h-3.5 mr-1.5', color)} />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={steps.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {steps.map((step, index) => {
                  const StepIcon = STEP_TYPES.find(t => t.value === step.type)?.icon || Mail
                  const stepColor = STEP_TYPES.find(t => t.value === step.type)?.color || 'text-gray-600'
                  const isExpanded = expandedStep === index

                  return (
                    <SortableStepCard
                      key={step.id || index}
                      id={String(index)}
                      step={step}
                      StepIcon={StepIcon}
                      stepColor={stepColor}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedStep(isExpanded ? null : index)}
                      onDelete={() => deleteStep(index)}
                      onUpdate={(updates) => updateStep(index, updates)}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Summary */}
      {steps.length > 0 && (
        <div className="admin-card p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span>Total Steps: <strong>{steps.length}</strong></span>
              <span>Duration: <strong>{calculateTotalDuration()}</strong></span>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Sequence'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sortable Step Card ──────────────────────────────────────────────

interface SortableStepCardProps {
  id: string
  step: SequenceStep
  StepIcon: React.ComponentType<{ className?: string }>
  stepColor: string
  isExpanded: boolean
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<SequenceStep>) => void
}

function SortableStepCard({ id, step, StepIcon, stepColor, isExpanded, onToggle, onDelete, onUpdate }: SortableStepCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('admin-card overflow-hidden transition-all', isExpanded && 'ring-2 ring-violet-500/20')}
    >
      {/* Step Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/30">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none">
          <GripVertical className="w-4 h-4" />
        </button>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', stepColor.replace('text-', 'bg-').replace('600', '100'))}>
          <StepIcon className={cn('w-4 h-4', stepColor)} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground">Step {step.step_number}</span>
            <Badge variant="outline" className="text-xs capitalize">{step.type === 'ab_test' ? 'A/B Test' : step.type}</Badge>
            {step.type === 'email' && step.subject && (
              <span className="text-xs text-muted-foreground truncate max-w-md">{step.subject}</span>
            )}
            {step.type === 'task' && step.task_title && (
              <span className="text-xs text-muted-foreground truncate max-w-md">{step.task_title}</span>
            )}
            {step.type === 'ab_test' && (
              <span className="text-xs text-muted-foreground">50/50 split</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={onToggle}>
            <svg className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-red-600 hover:text-red-700" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Step Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Delay Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Wait (days)</label>
              <Input type="number" min="0" value={step.delay_days || 0}
                onChange={(e) => onUpdate({ delay_days: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Wait (hours)</label>
              <Input type="number" min="0" max="23" value={step.delay_hours || 0}
                onChange={(e) => onUpdate({ delay_hours: parseInt(e.target.value) || 0 })} />
            </div>
          </div>

          {/* Email fields */}
          {step.type === 'email' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Subject *</label>
                <Input value={step.subject || ''} onChange={(e) => onUpdate({ subject: e.target.value })} placeholder="Email subject line" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Body</label>
                <textarea value={step.body || ''} onChange={(e) => onUpdate({ body: e.target.value })}
                  placeholder="Email body (supports {{first_name}}, {{company}}, etc.)"
                  className="w-full min-h-[200px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
              <p className="text-[10px] text-muted-foreground">An unsubscribe link will be automatically injected into all email steps.</p>
            </>
          )}

          {/* Task fields */}
          {step.type === 'task' && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Task Title *</label>
                <Input value={step.task_title || ''} onChange={(e) => onUpdate({ task_title: e.target.value })} placeholder="e.g., Follow up call" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
                <textarea value={step.task_description || ''} onChange={(e) => onUpdate({ task_description: e.target.value })}
                  placeholder="Task details"
                  className="w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>
            </>
          )}

          {/* Call fields */}
          {step.type === 'call' && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Call Script</label>
              <textarea value={step.call_script || ''} onChange={(e) => onUpdate({ call_script: e.target.value })}
                placeholder="Call talking points"
                className="w-full min-h-[200px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            </div>
          )}

          {/* A/B Test fields */}
          {step.type === 'ab_test' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="w-4 h-4 text-rose-600" />
                <span className="text-sm font-medium">A/B Test — contacts will be split 50/50</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Variant A</p>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
                    <Input value={step.ab_subject_a || ''} onChange={(e) => onUpdate({ ab_subject_a: e.target.value })} placeholder="Subject A" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
                    <textarea value={step.ab_body_a || ''} onChange={(e) => onUpdate({ ab_body_a: e.target.value })}
                      placeholder="Email body A"
                      className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Variant B</p>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
                    <Input value={step.ab_subject_b || ''} onChange={(e) => onUpdate({ ab_subject_b: e.target.value })} placeholder="Subject B" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
                    <textarea value={step.ab_body_b || ''} onChange={(e) => onUpdate({ ab_body_b: e.target.value })}
                      placeholder="Email body B"
                      className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
