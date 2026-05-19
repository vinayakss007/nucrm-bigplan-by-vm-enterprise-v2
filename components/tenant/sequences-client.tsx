"use client"

import { useState } from 'react'
import { Plus, Mail, Pause, Play, Archive, Copy, Trash2, Users, TrendingUp, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SequenceBuilder } from './sequence-builder'
import toast from 'react-hot-toast'

interface Sequence {
  id: string
  name: string
  description: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  total_steps: number
  total_duration_days: number
  enrollment_count: number
  active_count: number
  created_at: string
}

interface SequencesClientProps {
  sequences: any[]
  recentEnrollments: any[]
  permissions: { canView: boolean; canManage: boolean }
  tenantId: string
  userId: string
}

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  active: { label: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' },
  paused: { label: 'Paused', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  archived: { label: 'Archived', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

export default function SequencesClient({ sequences, permissions, tenantId, userId }: SequencesClientProps) {
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingSequence, setEditingSequence] = useState<any>(null)
  const [sequencesList, setSequencesList] = useState(sequences)

  const handleSaveSequence = async (sequenceData: any) => {
    const url = editingSequence 
      ? `/api/tenant/sequences/${editingSequence.id}`
      : '/api/tenant/sequences'
    
    const method = editingSequence ? 'PATCH' : 'POST'
    
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sequenceData),
    })
    
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to save')
    }
    
    // Reload sequences
    const res2 = await fetch('/api/tenant/sequences')
    const data = await res2.json()
    setSequencesList(data.data || [])
    setShowBuilder(false)
    setEditingSequence(null)
  }

  const handleToggleStatus = async (sequenceId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active'
    
    const res = await fetch(`/api/tenant/sequences/${sequenceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    
    if (!res.ok) {
      const data = await res.json()
      toast.error(data.error || 'Failed to update status')
      return
    }
    
    toast.success(`Sequence ${newStatus}`)
    setSequencesList(prev => prev.map(s => 
      s.id === sequenceId ? { ...s, status: newStatus } : s
    ))
  }

  const handleDeleteSequence = async (sequenceId: string) => {
    if (!confirm('Delete this sequence? This cannot be undone.')) return
    
    const res = await fetch(`/api/tenant/sequences/${sequenceId}`, {
      method: 'DELETE',
    })
    
    if (!res.ok) {
      const data = await res.json()
      toast.error(data.error || 'Failed to delete')
      return
    }
    
    toast.success('Sequence deleted')
    setSequencesList(prev => prev.filter(s => s.id !== sequenceId))
  }

  if (showBuilder || editingSequence) {
    return (
      <SequenceBuilder
        sequence={editingSequence}
        onSave={handleSaveSequence}
        onCancel={() => {
          setShowBuilder(false)
          setEditingSequence(null)
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Email Sequences</h1>
          <p className="text-sm text-muted-foreground">
            Automated drip campaigns for lead nurturing
          </p>
        </div>
        {permissions.canManage && (
          <Button onClick={() => setShowBuilder(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Sequence
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="admin-card p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Total Sequences</p>
            <Mail className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{sequencesList.length}</p>
        </div>
        <div className="admin-card p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Active Sequences</p>
            <Play className="w-4 h-4 text-green-600" />
          </div>
          <p className="text-2xl font-bold text-green-600">
            {sequencesList.filter(s => s.status === 'active').length}
          </p>
        </div>
        <div className="admin-card p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Total Enrollments</p>
            <Users className="w-4 h-4 text-violet-600" />
          </div>
          <p className="text-2xl font-bold text-violet-600">
            {sequencesList.reduce((sum, s) => sum + (parseInt(s.enrollment_count) || 0), 0)}
          </p>
        </div>
      </div>

      {/* Sequences List */}
      <div className="space-y-3">
        {sequencesList.length === 0 ? (
          <div className="admin-card p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-semibold mb-1">No sequences yet</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first email sequence to start nurturing leads automatically
            </p>
            {permissions.canManage && (
              <Button onClick={() => setShowBuilder(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Sequence
              </Button>
            )}
          </div>
        ) : (
          sequencesList.map((sequence) => {
            const statusCfg = STATUS_CONFIG[sequence.status as keyof typeof STATUS_CONFIG]
            
            return (
              <div key={sequence.id} className="admin-card p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{sequence.name}</h3>
                      <Badge className={cn('text-xs', statusCfg.color)}>
                        {statusCfg.label}
                      </Badge>
                    </div>
                    {sequence.description && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {sequence.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {sequence.total_steps} steps
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {sequence.total_duration_days} days
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {sequence.enrollment_count} enrolled
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {permissions.canManage && sequence.status !== 'archived' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleStatus(sequence.id, sequence.status)}
                      >
                        {sequence.status === 'active' ? (
                          <Pause className="w-3.5 h-3.5 mr-1.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {sequence.status === 'active' ? 'Pause' : 'Resume'}
                      </Button>
                    )}
                    {permissions.canManage && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingSequence(sequence)}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteSequence(sequence.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
