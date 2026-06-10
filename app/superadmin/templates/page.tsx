'use client';
import { useState, useEffect } from 'react';
import { Package, Plus, Users, FileText, Edit, Copy, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface Template {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  status: string;
  is_builtin: boolean;
  tenant_count: number;
  modules: string[];
  created_at: string;
}

export default function SuperAdminTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch('/api/superadmin/templates');
      const d = await res.json();
      setTemplates(d.data ?? []);
    } catch (e) {
      toast.error('Failed to load templates');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createTemplate = async () => {
    try {
      const res = await fetch('/api/superadmin/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Template',
          description: 'A new product template',
          icon: 'Package',
          modules: [],
          custom_fields: [],
          pipelines: [],
          automations: [],
          status: 'draft',
        }),
      });
      if (!res.ok) throw new Error('Create failed');
      const d = await res.json();
      toast.success('Template created');
      load();
    } catch (e) {
      toast.error('Failed to create template');
    }
  };

  const activeCount = templates.filter(t => t.status === 'active').length;
  const draftCount = templates.filter(t => t.status === 'draft').length;
  const totalAssignments = templates.reduce((s, t) => s + (t.tenant_count || 0), 0);

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-violet-400" />Template Builder
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            Create and manage product templates for tenants
          </p>
        </div>
        <button
          onClick={createTemplate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />Create New
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Templates', value: templates.length, color: 'text-white' },
          { label: 'Active', value: activeCount, color: 'text-emerald-400' },
          { label: 'Draft', value: draftCount, color: 'text-amber-400' },
          { label: 'Total Assignments', value: totalAssignments, color: 'text-violet-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/40">{s.label}</p>
            <p className={cn('text-2xl font-bold mt-1', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Template cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-48 rounded-xl animate-pulse bg-white/5" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/40">No templates yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(t => (
            <div key={t.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{t.icon || '📦'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{t.name}</p>
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize',
                      t.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' :
                      t.status === 'draft' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-slate-500/15 text-slate-400'
                    )}>
                      {t.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-white/40">
                  <Users className="w-3 h-3" />
                  <span>{t.tenant_count || 0}</span>
                </div>
              </div>

              <p className="text-xs text-white/40 leading-relaxed flex-1">
                {t.description || 'No description'}
              </p>

              <div className="flex items-center gap-1 text-xs text-white/30">
                <FileText className="w-3 h-3" />
                <span>{Array.isArray(t.modules) ? t.modules.length : 0} modules</span>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t border-white/5">
                <Link
                  href={`/superadmin/templates/${t.id}`}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Edit className="w-3 h-3" />Edit
                </Link>
                <button
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Copy className="w-3 h-3" />Clone
                </button>
                <button
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <UserPlus className="w-3 h-3" />Assign
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
