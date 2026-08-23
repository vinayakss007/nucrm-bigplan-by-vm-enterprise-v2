/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Loader2, ChevronDown, ChevronRight, GitBranch, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';

interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  color?: string | null;
}

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  dealCount: number;
  stages: Stage[];
}

type PipelineType = 'sales' | 'support' | 'custom';

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Create pipeline dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    type: 'sales' as PipelineType,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  // Add stage dialog state
  const [addStagePipelineId, setAddStagePipelineId] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState({ name: '', order: 0, color: '#6366f1' });
  const [savingStage, setSavingStage] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);

  const loadPipelines = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/tenant/pipelines');
      if (!res.ok) throw new Error('Failed to fetch pipelines');
      const json = await res.json();
      setPipelines(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipelines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPipelines(); }, [loadPipelines]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreatePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
          type: createForm.type,
          is_active: createForm.is_active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create pipeline');
      toast.success('Pipeline created');
      setShowCreate(false);
      setCreateForm({ name: '', description: '', type: 'sales', is_active: true });
      loadPipelines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create pipeline');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePipeline = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/tenant/pipelines/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete pipeline');
      toast.success('Pipeline deleted');
      setPipelines(prev => prev.filter(p => p.id !== deleteTarget.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete pipeline');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addStagePipelineId || !stageForm.name.trim()) return;
    setSavingStage(true);
    try {
      const pipeline = pipelines.find(p => p.id === addStagePipelineId);
      if (!pipeline) return;

      // Use PATCH to update the pipeline with the new stage appended
      const existingStages = pipeline.stages.map(s => ({ name: s.name, order: s.order }));
      const newStages = [...existingStages, { name: stageForm.name.trim(), order: stageForm.order }];

      const res = await fetch(`/api/tenant/pipelines/${addStagePipelineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: newStages }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add stage');
      toast.success('Stage added');
      setAddStagePipelineId(null);
      setStageForm({ name: '', order: 0, color: '#6366f1' });
      loadPipelines();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add stage');
    } finally {
      setSavingStage(false);
    }
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

  if (loading) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 bg-muted rounded-xl animate-pulse" />
          <div className="h-9 w-36 bg-muted rounded-xl animate-pulse" />
        </div>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1600px] mx-auto">
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <p className="text-red-500 font-medium">{error}</p>
          <button
            onClick={loadPipelines}
            className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-violet-500" />
            Pipelines
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            <span className="text-violet-600 font-semibold">{pipelines.length}</span>{' '}
            pipeline{pipelines.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          <Plus className="w-4 h-4" />
          New Pipeline
        </button>
      </div>

      {/* Create pipeline form */}
      {showCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Create Pipeline</h3>
            <button onClick={() => setShowCreate(false)}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <form onSubmit={handleCreatePipeline} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className={inp}
                  placeholder="e.g. Sales Pipeline"
                  autoFocus
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  className={inp}
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
                <select
                  value={createForm.type}
                  onChange={e => setCreateForm(f => ({ ...f, type: e.target.value as PipelineType }))}
                  className={inp}
                >
                  <option value="sales">Sales</option>
                  <option value="support">Support</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <label className="text-xs font-medium text-muted-foreground">Active</label>
                <button
                  type="button"
                  onClick={() => setCreateForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    createForm.is_active ? 'bg-violet-600' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      createForm.is_active ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !createForm.name.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pipelines list */}
      {pipelines.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <GitBranch className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No pipelines yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create a pipeline to organize your deals into stages
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" />
            Create First Pipeline
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map(pipeline => {
            const isExpanded = expanded.has(pipeline.id);
            return (
              <div
                key={pipeline.id}
                className="rounded-2xl border border-border bg-card overflow-hidden transition-all"
              >
                {/* Pipeline row */}
                <div className="flex items-center gap-4 p-4">
                  <button
                    onClick={() => toggleExpand(pipeline.id)}
                    className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0 hover:bg-violet-200 dark:hover:bg-violet-950/60 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-violet-600" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-violet-600" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{pipeline.name}</p>
                      {pipeline.isDefault && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
                          DEFAULT
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                        ACTIVE
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pipeline.description || 'No description'}
                      {' · '}
                      {pipeline.stages.length} stage{pipeline.stages.length !== 1 ? 's' : ''}
                      {' · '}
                      {pipeline.dealCount} deal{pipeline.dealCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!pipeline.isDefault && (
                      <button
                        onClick={() => setDeleteTarget(pipeline)}
                        className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 text-muted-foreground transition-colors"
                        title="Delete pipeline"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded stages section */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        Stages
                      </h4>
                      <button
                        onClick={() => {
                          setAddStagePipelineId(pipeline.id);
                          setStageForm({
                            name: '',
                            order: pipeline.stages.length,
                            color: '#6366f1',
                          });
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Add Stage
                      </button>
                    </div>

                    {pipeline.stages.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No stages defined</p>
                    ) : (
                      <div className="space-y-1.5">
                        {pipeline.stages
                          .sort((a, b) => a.order - b.order)
                          .map(stage => (
                            <div
                              key={stage.id}
                              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-background border border-border"
                            >
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: stage.color || '#6366f1' }}
                              />
                              <span className="text-sm font-medium flex-1">{stage.name}</span>
                              <span className="text-xs text-muted-foreground">
                                Order: {stage.order}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Add stage inline form */}
                    {addStagePipelineId === pipeline.id && (
                      <form
                        onSubmit={handleAddStage}
                        className="mt-3 p-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-background space-y-3"
                      >
                        <p className="text-xs font-semibold">Add New Stage</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Name *</label>
                            <input
                              value={stageForm.name}
                              onChange={e => setStageForm(f => ({ ...f, name: e.target.value }))}
                              required
                              className={inp}
                              placeholder="Stage name"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Order</label>
                            <input
                              type="number"
                              min={0}
                              value={stageForm.order}
                              onChange={e => setStageForm(f => ({ ...f, order: parseInt(e.target.value) || 0 }))}
                              className={inp}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={stageForm.color}
                                onChange={e => setStageForm(f => ({ ...f, color: e.target.value }))}
                                className="w-8 h-8 rounded border border-border cursor-pointer"
                              />
                              <span className="text-xs text-muted-foreground font-mono">
                                {stageForm.color}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setAddStagePipelineId(null)}
                            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingStage || !stageForm.name.trim()}
                            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50"
                          >
                            {savingStage && <Loader2 className="w-3 h-3 animate-spin" />}
                            Add Stage
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Delete Pipeline"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeletePipeline}
      />
    </div>
  );
}
