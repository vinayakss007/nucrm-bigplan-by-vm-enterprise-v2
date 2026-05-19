"use client"

import { useState, useCallback } from 'react'
import { Plus, Mail, Calendar, Clock, Phone, Pause, Trash2, Edit, Play, Copy, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import toast from 'react-hot-toast'

interface SequenceStep {
  id?: string
  step_number: number
  type: 'email' | 'task' | 'wait' | 'call'
  subject?: string
  body?: string
  delay_days?: number
  delay_hours?: number
  task_title?: string
  task_description?: string
  call_script?: string
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
]

export function SequenceBuilder({ sequence, onSave, onCancel }: SequenceBuilderProps) {
  const [name, setName] = useState(sequence?.name || '')
  const [description, setDescription] = useState(sequence?.description || '')
  const [steps, setSteps] = useState<SequenceStep[]>(sequence?.steps || [])
  const [saving, setSaving] = useState(false)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  const addStep = (type: 'email' | 'task' | 'wait' | 'call') => {
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
    newSteps.forEach((step, i) => {
      step.step_number = i + 1
    })
    setSteps(newSteps)
  }

  const moveStep = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || 
        (direction === 'down' && index === steps.length - 1)) {
      return
    }
    const newSteps = [...steps]
    const temp = newSteps[index]!
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    newSteps[index] = newSteps[swapIndex]!
    newSteps[swapIndex] = temp
    newSteps.forEach((step, i) => {
      step.step_number = i + 1
    })
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
          <div className="space-y-3">
            {steps.map((step, index) => {
              const StepIcon = STEP_TYPES.find(t => t.value === step.type)?.icon || Mail
              const stepColor = STEP_TYPES.find(t => t.value === step.type)?.color || 'text-gray-600'
              const isExpanded = expandedStep === index

              return (
                <div
                  key={step.id || index}
                  className={cn(
                    'admin-card overflow-hidden transition-all',
                    isExpanded && 'ring-2 ring-violet-500/20'
                  )}
                >
                  {/* Step Header */}
                  <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/30">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', stepColor.replace('text-', 'bg-').replace('600', '100'))}>
                      <StepIcon className={cn('w-4 h-4', stepColor)} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">Step {step.step_number}</span>
                        <Badge variant="outline" className="text-xs capitalize">{step.type}</Badge>
                        {step.type === 'email' && step.subject && (
                          <span className="text-xs text-muted-foreground truncate max-w-md">
                            {step.subject}
                          </span>
                        )}
                        {step.type === 'task' && step.task_title && (
                          <span className="text-xs text-muted-foreground truncate max-w-md">
                            {step.task_title}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveStep(index, 'up')}
                        disabled={index === 0}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => moveStep(index, 'down')}
                        disabled={index === steps.length - 1}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setExpandedStep(isExpanded ? null : index)}
                      >
                        <svg 
                          className={cn('w-4 h-4 transition-transform', isExpanded && 'rotate-180')} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                        onClick={() => deleteStep(index)}
                      >
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
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Wait (days)
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={step.delay_days || 0}
                            onChange={(e) => updateStep(index, { delay_days: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Wait (hours)
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max="23"
                            value={step.delay_hours || 0}
                            onChange={(e) => updateStep(index, { delay_hours: parseInt(e.target.value) || 0 })}
                          />
                        </div>
                      </div>

                      {/* Type-Specific Fields */}
                      {step.type === 'email' && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                              Subject *
                            </label>
                            <Input
                              value={step.subject || ''}
                              onChange={(e) => updateStep(index, { subject: e.target.value })}
                              placeholder="Email subject line"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                              Body
                            </label>
                            <textarea
                              value={step.body || ''}
                              onChange={(e) => updateStep(index, { body: e.target.value })}
                              placeholder="Email body (supports {{first_name}}, {{company}}, etc.)"
                              className="w-full min-h-[200px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                        </>
                      )}

                      {step.type === 'task' && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                              Task Title *
                            </label>
                            <Input
                              value={step.task_title || ''}
                              onChange={(e) => updateStep(index, { task_title: e.target.value })}
                              placeholder="e.g., Follow up call"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                              Description
                            </label>
                            <textarea
                              value={step.task_description || ''}
                              onChange={(e) => updateStep(index, { task_description: e.target.value })}
                              placeholder="Task details"
                              className="w-full min-h-[100px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                          </div>
                        </>
                      )}

                      {step.type === 'call' && (
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            Call Script
                          </label>
                          <textarea
                            value={step.call_script || ''}
                            onChange={(e) => updateStep(index, { call_script: e.target.value })}
                            placeholder="Call talking points"
                            className="w-full min-h-[200px] px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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
