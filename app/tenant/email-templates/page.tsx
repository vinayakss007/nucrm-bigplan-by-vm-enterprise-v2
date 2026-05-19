'use client';
import { useState, useEffect } from 'react';
import { Mail, Plus, Pencil, Trash2, Eye, Copy, Save, X, Variable } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { sanitizeHTML } from '@/lib/sanitize';

const VARIABLES = [
  { key: '{{first_name}}',    label: 'First Name' },
  { key: '{{last_name}}',     label: 'Last Name' },
  { key: '{{email}}',         label: 'Email' },
  { key: '{{company_name}}',  label: 'Company' },
  { key: '{{tenant_name}}',   label: 'Your Company Name' },
  { key: '{{deal_title}}',    label: 'Deal Title' },
  { key: '{{deal_value}}',    label: 'Deal Value' },
];

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  created_at: string;
  updated_at: string;
}

interface EditorProps {
  template?: Partial<Template>;
  onSave: (t: Partial<Template>) => void;
  onCancel: () => void;
}

function TemplateEditor({ template, onSave, onCancel }: EditorProps) {
  const [form, setForm] = useState({
    name: template?.name ?? '',
    subject: template?.subject ?? '',
    body: template?.body ?? '',
    category: template?.category ?? 'general',
  });
  const [preview, setPreview] = useState(false);

  const insert = (variable: string) => {
    setForm(f => ({ ...f, body: f.body + variable }));
  };

  const renderPreview = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/{{first_name}}/g, 'Jane')
      .replace(/{{last_name}}/g, 'Smith')
      .replace(/{{email}}/g, 'jane@example.com')
      .replace(/{{company_name}}/g, 'Acme Corp')
      .replace(/{{tenant_name}}/g, 'Your Company')
      .replace(/{{deal_title}}/g, 'Enterprise Deal')
      .replace(/{{deal_value}}/g, '$12,000')
      .replace(/\n/g, '<br>');

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-bold">{template?.id ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Template Name</label>
              <input
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Welcome Email"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <select
                value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {['general','sales','onboarding','follow-up','nurture','win'].map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Subject Line</label>
            <input
              value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Welcome, {{first_name}}!"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium">Body</label>
              <button
                onClick={() => setPreview(p => !p)}
                className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
                  preview ? 'bg-violet-100 text-violet-700' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                <Eye className="w-3.5 h-3.5" />{preview ? 'Edit' : 'Preview'}
              </button>
            </div>

            {preview ? (
              <div
                className="min-h-48 rounded-xl border border-border p-4 text-sm bg-white dark:bg-slate-900 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHTML(renderPreview(form.body)) }}
              />
            ) : (
              <textarea
                value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={10}
                placeholder="Write your email body here. Use variables like {{first_name}} for personalisation."
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono resize-none"
              />
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Variable className="w-3.5 h-3.5" />Click to insert variable
            </p>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map(v => (
                <button key={v.key} onClick={() => insert(v.key)}
                  className="px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 text-xs font-mono hover:bg-violet-100 transition-colors border border-violet-200 dark:border-violet-800">
                  {v.key}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-border">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={() => {
              if (!form.name.trim()) { toast.error('Template name is required'); return; }
              if (!form.subject.trim()) { toast.error('Subject line is required'); return; }
              if (!form.body.trim()) { toast.error('Body is required'); return; }
              onSave({ ...template, ...form });
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />Save Template
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/email-templates');
      const d = await res.json();
      setTemplates(d.data ?? []);
    } catch { toast.error('Failed to load templates'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async (t: Partial<Template>) => {
    const isNew = !t.id;
    const res = await fetch(isNew ? '/api/tenant/email-templates' : `/api/tenant/email-templates/${t.id}`, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    if (res.ok) {
      toast.success(isNew ? 'Template created' : 'Template updated');
      setEditing(null); setCreating(false);
      load();
    } else {
      const d = await res.json();
      toast.error(d.error || 'Failed to save');
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    const res = await fetch(`/api/tenant/email-templates/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Deleted'); setTemplates(ts => ts.filter(t => t.id !== id)); }
    else toast.error('Failed to delete');
  };

  const duplicate = async (t: Template) => {
    const res = await fetch('/api/tenant/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...t, id: undefined, name: `${t.name} (copy)` }),
    });
    if (res.ok) { toast.success('Duplicated'); load(); }
    else toast.error('Failed to duplicate');
  };

  const categories = ['all', ...Array.from(new Set(templates.map(t => t.category).filter(Boolean)))];
  const visible = filter === 'all' ? templates : templates.filter(t => t.category === filter);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Mail className="w-5 h-5" />Email Templates
          </h1>
          <p className="text-sm text-muted-foreground">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />New Template
        </button>
      </div>

      {/* Category filter */}
      {categories.length > 1 && (
        <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit flex-wrap">
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                filter === c ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_,i) => (
            <div key={i} className="admin-card p-5 animate-pulse">
              <div className="h-4 w-3/4 bg-muted rounded mb-2" />
              <div className="h-3 w-1/2 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : !visible.length ? (
        <div className="admin-card py-20 text-center">
          <Mail className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="font-semibold">No templates yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create reusable email templates for sequences, automations, and manual sends.</p>
          <button onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors">
            <Plus className="w-4 h-4" />Create your first template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map(t => (
            <div key={t.id} className="admin-card p-5 group hover:border-violet-200 dark:hover:border-violet-800 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 capitalize shrink-0">
                  {t.category}
                </span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{t.body}</p>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditing(t)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="w-3.5 h-3.5" />Edit
                </button>
                <button onClick={() => duplicate(t)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-muted text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <Copy className="w-3.5 h-3.5" />Copy
                </button>
                <button onClick={() => del(t.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-medium text-muted-foreground hover:text-red-500 transition-colors ml-auto">
                  <Trash2 className="w-3.5 h-3.5" />Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateEditor
          template={creating ? {} : editing!}
          onSave={save}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
