'use client';
import { useState, useEffect, use } from 'react';
import {
  Package, Save, ArrowLeft, Plus, Trash2, GripVertical, Zap, Users, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface CustomField {
  entity: string;
  label: string;
  key: string;
  type: string;
}

interface PipelineStage {
  name: string;
  stages: string[];
}

interface AutomationRule {
  name: string;
  trigger: string;
  action: string;
  config: Record<string, unknown>;
}

interface TemplateData {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: string;
  modules: string[];
  custom_fields: CustomField[];
  pipelines: PipelineStage[];
  automations: AutomationRule[];
}

const FIELD_TYPES = ['text', 'number', 'select', 'checkbox', 'date', 'email', 'url'];
const ENTITIES = ['contact', 'deal', 'company'];
const TRIGGERS = ['contact.created', 'contact.updated', 'deal.created', 'deal.stage_changed', 'deal.won', 'task.completed'];
const ACTIONS = ['send_email', 'send_notification', 'create_task', 'update_field', 'webhook'];

export default function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [availableModules, setAvailableModules] = useState<Array<{ id: string; name: string; icon: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/superadmin/templates/${id}`).then(r => r.json()),
      fetch('/api/superadmin/modules').then(r => r.json()),
    ]).then(([tmpl, mods]) => {
      setTemplate(tmpl.data ?? tmpl);
      setAvailableModules((mods.data ?? []).map((m: { id: string; name: string; icon: string }) => ({ id: m.id, name: m.name, icon: m.icon })));
      setLoading(false);
    }).catch(() => {
      toast.error('Failed to load template');
      setLoading(false);
    });
  }, [id]);

  const update = (patch: Partial<TemplateData>) => {
    if (template) setTemplate({ ...template, ...patch });
  };

  const saveTemplate = async () => {
    if (!template) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/superadmin/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          icon: template.icon,
          status: template.status,
          modules: template.modules,
          custom_fields: template.custom_fields,
          pipelines: template.pipelines,
          automations: template.automations,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Template saved');
    } catch {
      toast.error('Failed to save template');
    }
    setSaving(false);
  };

  const assignToTenant = async () => {
    if (!assignTenantId.trim()) return;
    try {
      const res = await fetch(`/api/superadmin/templates/${id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: assignTenantId.trim() }),
      });
      if (!res.ok) throw new Error('Assign failed');
      toast.success('Template assigned to tenant');
      setAssignTenantId('');
      setShowAssign(false);
    } catch {
      toast.error('Failed to assign template');
    }
  };

  const toggleModule = (moduleId: string) => {
    if (!template) return;
    const mods = template.modules.includes(moduleId)
      ? template.modules.filter(m => m !== moduleId)
      : [...template.modules, moduleId];
    update({ modules: mods });
  };

  const addCustomField = () => {
    if (!template) return;
    update({ custom_fields: [...template.custom_fields, { entity: 'contact', label: '', key: '', type: 'text' }] });
  };

  const updateField = (idx: number, patch: Partial<CustomField>) => {
    if (!template) return;
    const fields = [...template.custom_fields];
    const field = fields[idx];
    if (field) {
      fields[idx] = { ...field, ...patch };
      update({ custom_fields: fields });
    }
  };

  const removeField = (idx: number) => {
    if (!template) return;
    update({ custom_fields: template.custom_fields.filter((_, i) => i !== idx) });
  };

  const addPipeline = () => {
    if (!template) return;
    update({ pipelines: [...template.pipelines, { name: 'New Pipeline', stages: ['Stage 1', 'Stage 2'] }] });
  };

  const updatePipeline = (idx: number, patch: Partial<PipelineStage>) => {
    if (!template) return;
    const pipes = [...template.pipelines];
    const pipe = pipes[idx];
    if (pipe) {
      pipes[idx] = { ...pipe, ...patch };
      update({ pipelines: pipes });
    }
  };

  const removePipeline = (idx: number) => {
    if (!template) return;
    update({ pipelines: template.pipelines.filter((_, i) => i !== idx) });
  };

  const addStage = (pipeIdx: number) => {
    if (!template) return;
    const pipes = [...template.pipelines];
    const pipe = pipes[pipeIdx];
    if (pipe) {
      pipes[pipeIdx] = { ...pipe, stages: [...pipe.stages, 'New Stage'] };
      update({ pipelines: pipes });
    }
  };

  const updateStage = (pipeIdx: number, stageIdx: number, value: string) => {
    if (!template) return;
    const pipes = [...template.pipelines];
    const pipe = pipes[pipeIdx];
    if (pipe) {
      const stages = [...pipe.stages];
      stages[stageIdx] = value;
      pipes[pipeIdx] = { ...pipe, stages };
      update({ pipelines: pipes });
    }
  };

  const removeStage = (pipeIdx: number, stageIdx: number) => {
    if (!template) return;
    const pipes = [...template.pipelines];
    const pipe = pipes[pipeIdx];
    if (pipe) {
      pipes[pipeIdx] = { ...pipe, stages: pipe.stages.filter((_, i) => i !== stageIdx) };
      update({ pipelines: pipes });
    }
  };

  const moveStage = (pipeIdx: number, stageIdx: number, direction: 'up' | 'down') => {
    if (!template) return;
    const pipes = [...template.pipelines];
    const pipe = pipes[pipeIdx];
    if (!pipe) return;
    const stages = [...pipe.stages];
    const targetIdx = direction === 'up' ? stageIdx - 1 : stageIdx + 1;
    if (targetIdx < 0 || targetIdx >= stages.length) return;
    const current = stages[stageIdx];
    const target = stages[targetIdx];
    if (current !== undefined && target !== undefined) {
      stages[stageIdx] = target;
      stages[targetIdx] = current;
      pipes[pipeIdx] = { ...pipe, stages };
      update({ pipelines: pipes });
    }
  };

  const addAutomation = () => {
    if (!template) return;
    update({ automations: [...template.automations, { name: 'New Rule', trigger: 'contact.created', action: 'send_notification', config: {} }] });
  };

  const updateAutomation = (idx: number, patch: Partial<AutomationRule>) => {
    if (!template) return;
    const auto = [...template.automations];
    const rule = auto[idx];
    if (rule) {
      auto[idx] = { ...rule, ...patch };
      update({ automations: auto });
    }
  };

  const removeAutomation = (idx: number) => {
    if (!template) return;
    update({ automations: template.automations.filter((_, i) => i !== idx) });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-5 max-w-5xl">
        <div className="h-5 w-32 bg-white/10 rounded" />
        <div className="h-64 bg-white/5 rounded-xl" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-white/40">Template not found</p>
        <Link href="/superadmin/templates" className="text-xs text-violet-400 hover:underline mt-2 inline-block">
          Back to templates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/superadmin/templates" className="p-2 rounded-lg hover:bg-white/5 transition-colors">
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-white">Edit Template</h1>
            <p className="text-xs text-white/40">{template.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAssign(!showAssign)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-white/60 hover:text-white text-xs font-semibold transition-colors"
          >
            <Users className="w-3.5 h-3.5" />Assign
          </button>
          <button
            onClick={saveTemplate}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Assign modal */}
      {showAssign && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex gap-2">
          <input
            type="text"
            value={assignTenantId}
            onChange={(e) => setAssignTenantId(e.target.value)}
            placeholder="Tenant ID"
            className="flex-1 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <button onClick={assignToTenant} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors">
            Assign
          </button>
        </div>
      )}

      {/* Basic Info */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Basic Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Name</label>
            <input
              type="text"
              value={template.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Icon</label>
            <input
              type="text"
              value={template.icon}
              onChange={(e) => update({ icon: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-white/40 mb-1 block">Description</label>
            <textarea
              value={template.description}
              onChange={(e) => update({ description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Status</label>
            <select
              value={template.status}
              onChange={(e) => update({ status: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
      </section>

      {/* Module Selector */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Modules</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {availableModules.map(mod => {
            const isActive = template.modules.includes(mod.id);
            return (
              <button
                key={mod.id}
                onClick={() => toggleModule(mod.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left',
                  isActive
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                    : 'border-white/10 bg-white/5 text-white/40 hover:text-white/60'
                )}
              >
                <span>{mod.icon || '🔌'}</span>
                <span className="truncate">{mod.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Custom Fields */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Custom Fields</h2>
          <button onClick={addCustomField} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
            <Plus className="w-3 h-3" />Add Field
          </button>
        </div>
        {template.custom_fields.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-4">No custom fields. Click Add Field to create one.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[100px_1fr_120px_100px_40px] gap-2 text-[10px] text-white/40 font-bold uppercase px-1">
              <span>Entity</span><span>Label</span><span>Key</span><span>Type</span><span></span>
            </div>
            {template.custom_fields.map((field, idx) => (
              <div key={idx} className="grid grid-cols-[100px_1fr_120px_100px_40px] gap-2 items-center">
                <select
                  value={field.entity}
                  onChange={(e) => updateField(idx, { entity: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                >
                  {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  placeholder="Field label"
                  className="px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                />
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => updateField(idx, { key: e.target.value })}
                  placeholder="field_key"
                  className="px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(idx, { type: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                >
                  {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => removeField(idx)} className="p-1 text-red-400 hover:text-red-300">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pipeline Stages */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Pipeline Stages</h2>
          <button onClick={addPipeline} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
            <Plus className="w-3 h-3" />Add Pipeline
          </button>
        </div>
        {template.pipelines.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-4">No pipelines. Click Add Pipeline to create one.</p>
        ) : (
          <div className="space-y-4">
            {template.pipelines.map((pipe, pipeIdx) => (
              <div key={pipeIdx} className="rounded-lg border border-white/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pipe.name}
                    onChange={(e) => updatePipeline(pipeIdx, { name: e.target.value })}
                    className="flex-1 px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs font-semibold focus:outline-none"
                  />
                  <button onClick={() => removePipeline(pipeIdx)} className="p-1 text-red-400 hover:text-red-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {pipe.stages.map((stage, stageIdx) => (
                    <div key={stageIdx} className="flex items-center gap-1.5">
                      <GripVertical className="w-3 h-3 text-white/20 shrink-0" />
                      <input
                        type="text"
                        value={stage}
                        onChange={(e) => updateStage(pipeIdx, stageIdx, e.target.value)}
                        className="flex-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                      />
                      <button onClick={() => moveStage(pipeIdx, stageIdx, 'up')} disabled={stageIdx === 0} className="p-0.5 text-white/30 hover:text-white disabled:opacity-20">
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button onClick={() => moveStage(pipeIdx, stageIdx, 'down')} disabled={stageIdx === pipe.stages.length - 1} className="p-0.5 text-white/30 hover:text-white disabled:opacity-20">
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button onClick={() => removeStage(pipeIdx, stageIdx)} className="p-0.5 text-red-400 hover:text-red-300">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addStage(pipeIdx)} className="text-[10px] text-violet-400 hover:text-violet-300">
                  + Add Stage
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Automation Rules */}
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />Automation Rules
          </h2>
          <button onClick={addAutomation} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
            <Plus className="w-3 h-3" />Add Rule
          </button>
        </div>
        {template.automations.length === 0 ? (
          <p className="text-xs text-white/30 text-center py-4">No automations. Click Add Rule to create one.</p>
        ) : (
          <div className="space-y-3">
            {template.automations.map((auto, idx) => (
              <div key={idx} className="rounded-lg border border-white/10 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={auto.name}
                    onChange={(e) => updateAutomation(idx, { name: e.target.value })}
                    placeholder="Rule name"
                    className="flex-1 px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                  />
                  <button onClick={() => removeAutomation(idx)} className="p-1 text-red-400 hover:text-red-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-white/40 mb-0.5 block">Trigger</label>
                    <select
                      value={auto.trigger}
                      onChange={(e) => updateAutomation(idx, { trigger: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                    >
                      {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 mb-0.5 block">Action</label>
                    <select
                      value={auto.action}
                      onChange={(e) => updateAutomation(idx, { action: e.target.value })}
                      className="w-full px-2 py-1.5 rounded-md border border-white/10 bg-white/5 text-white text-xs focus:outline-none"
                    >
                      {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
