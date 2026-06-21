'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, ExternalLink, Copy, Check, ToggleLeft, ToggleRight,
  Trash2, Loader2, X, Eye, ChevronRight } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const FIELD_TYPES = [
  { id:'text', label:'Text' }, { id:'email', label:'Email' },
  { id:'phone', label:'Phone' }, { id:'textarea', label:'Long text' },
  { id:'select', label:'Dropdown' }, { id:'checkbox', label:'Checkbox' },
  { id:'number', label:'Number' }, { id:'date', label:'Date' },
];

export default function FormsPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [forms, setForms]       = useState<Record<string, any>[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [_selected, _setSelected] = useState<Record<string, unknown>|null>(null);
  const [saving, setSaving]     = useState(false);
  const [copiedId, setCopiedId] = useState<string|null>(null);
  const [form, setForm] = useState({
    name:'', description:'',
    fields:[
      { key:'first_name', label:'First Name', type:'text', required:true },
      { key:'email',      label:'Email',      type:'email', required:true },
      { key:'message',    label:'Message',    type:'textarea', required:false },
    ],
    settings:{ success_message:'Thank you! We will be in touch.', notify_email:'' },
  });

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/tenant/forms');
    if (res.ok) { const d = await res.json(); setForms(d.data ?? []); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch('/api/tenant/forms', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) { toast.success('Form created'); setShowCreate(false); load(); }
    else toast.error(d.error ?? 'Failed');
    setSaving(false);
  };

  const toggle = async (f: { id: string; is_active?: boolean }) => {
    await fetch(`/api/tenant/forms/${f.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ is_active: !f.is_active }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setForms((forms: any) => forms.map((x: any) => x.id === f.id ? {...x, is_active: !f.is_active} : x));
  };

  const del = async (id: string) => {
      await fetch(`/api/tenant/forms/${id}`, { method:'DELETE' });
    setForms(f => f.filter(x => x.id !== id));
    toast.success('Deleted');
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [viewingSubmissions, setViewingSubmissions] = useState<Record<string, any>|null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [submissions, setSubmissions] = useState<Record<string, any>[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  const viewSubmissions = async (form: { id: string }) => {
    setViewingSubmissions(form);
    setLoadingSubmissions(true);
    try {
      const res = await fetch(`/api/tenant/forms/${form.id}`);
      if (res.ok) {
        const d = await res.json();
        setSubmissions(d.data?.submissions ?? []);
      }
    } catch {
      toast.error('Failed to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const copyEmbed = (formId: string) => {
    const script = `<script src="${window.location.origin}/embed/form.js" data-form-id="${formId}"></script>`;
    navigator.clipboard.writeText(script);
    setCopiedId(formId);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Embed code copied!');
  };

  const copyPublicLink = (formId: string) => {
    const url = `${window.location.origin}/forms/public/${formId}`;
    navigator.clipboard.writeText(url);
    setCopiedId(formId);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Public form link copied! Share this URL with anyone.');
  };

  const openPublicForm = (formId: string) => {
    window.open(`/forms/public/${formId}`, '_blank');
  };

  const addField = () => setForm(f => ({...f, fields:[...f.fields, { key:`field_${Date.now()}`, label:'New Field', type:'text', required:false }]}));
  const removeField = (i: number) => setForm((f: any) => ({...f, fields:f.fields.filter((_: any, idx: number) => idx !== i)}));
  const updateField = (i: number, key: string, val: any) =>
    setForm((f: any) => ({...f, fields:f.fields.map((x: Record<string, any>, idx: number) => idx === i ? {...x, [key]:val} : x)}));

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Forms</h1>
          <p className="text-sm text-muted-foreground">Build lead capture forms — embed anywhere with one line of code</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4"/>New Form
        </button>
      </div>

      {/* Create form builder */}
      {showCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Form</h3>
            <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={create} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Form Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name:e.target.value}))} required className={inp} placeholder="e.g. Contact Us Form" autoFocus />
              </div>
            </div>

            {/* Fields builder */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold">Fields ({form.fields.length})</h4>
                <button type="button" onClick={addField} className="text-xs text-violet-600 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" />Add field
                </button>
              </div>
              <div className="space-y-2">
                {form.fields.map((field, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <input value={field.label} onChange={e => updateField(i, 'label', e.target.value)}
                        className={inp} placeholder="Field label" />
                      <select value={field.type} onChange={e => updateField(i, 'type', e.target.value)} className={inp}>
                        {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={field.required} onChange={e => updateField(i, 'required', e.target.checked)}
                          className="w-4 h-4 rounded border-border text-violet-600" />
                        Required
                      </label>
                    </div>
                    {form.fields.length > 1 && (
                      <button type="button" onClick={() => removeField(i)} className="text-muted-foreground hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Settings */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Settings</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Success message</label>
                  <input value={form.settings.success_message} onChange={e => setForm(f => ({...f, settings:{...f.settings, success_message:e.target.value}}))} className={inp} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Notify email (on submission)</label>
                  <input type="email" value={form.settings.notify_email} onChange={e => setForm(f => ({...f, settings:{...f.settings, notify_email:e.target.value}}))} className={inp} placeholder="your@email.com" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving||!form.name} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create Form
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Forms list */}
      {loading ? [...Array(3)].map((_,i) => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />) :
      forms.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No forms yet</p>
          <p className="text-sm text-muted-foreground mt-1">Build a lead capture form and embed it on any website in seconds</p>
          <button onClick={() => setShowCreate(true)} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto hover:bg-violet-700">
            <Plus className="w-4 h-4"/>Build First Form
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map(f => (
            <div key={f.id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{f.name}</p>
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                    f.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                    {f.is_active ? 'Active' : 'Paused'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {f.submissions ?? 0} submissions
                  {Array.isArray(f.fields) && ` · ${f.fields.length} fields`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <button onClick={() => viewSubmissions(f as any)} title="View submissions"
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/60 text-xs font-medium transition-colors">
                  <FileText className="w-3.5 h-3.5" /> <span className="hidden md:inline">Submissions</span>
                </button>
                <button onClick={() => openPublicForm(f.id)} title="View public form"
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors">
                  <Eye className="w-3.5 h-3.5" /> <span className="hidden md:inline">View</span>
                </button>
                <button onClick={() => copyPublicLink(f.id)} title="Copy share link"
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" /> <span className="hidden md:inline">Share</span>
                </button>
                <button onClick={() => copyEmbed(f.id)} title="Copy embed code"
                  className="hidden sm:flex p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                  {copiedId === f.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <button onClick={() => toggle(f as any)} title="Toggle active"
                  className="text-muted-foreground hover:text-violet-600 transition-colors">
                  {f.is_active ? <ToggleRight className="w-5 h-5 text-violet-600" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={() => del(f.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {/* Submissions Modal */}
          {viewingSubmissions && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setViewingSubmissions(null)} />
              <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{viewingSubmissions.name}</h3>
                      <p className="text-xs text-muted-foreground">Recent Submissions</p>
                    </div>
                  </div>
                  <button onClick={() => setViewingSubmissions(null)} className="p-2 hover:bg-accent rounded-lg transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-0 scrollbar-thin">
                  {loadingSubmissions ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
                      <p className="text-sm text-muted-foreground font-medium">Loading submissions...</p>
                    </div>
                  ) : submissions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-10">
                      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                        <FileText className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                      <h4 className="font-bold">No submissions yet</h4>
                      <p className="text-sm text-muted-foreground mt-1 max-w-xs">Share your form link or embed it on your site to start collecting leads.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {submissions.map((sub, _i) => (
                        <div key={sub.id} className="p-5 hover:bg-accent/30 transition-colors">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">
                                {sub.contact_email ? sub.contact_email.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div>
                                <p className="text-sm font-bold">{sub.first_name || 'Anonymous'} {sub.last_name || ''}</p>
                                <p className="text-xs text-muted-foreground">{sub.contact_email || 'No email provided'}</p>
                              </div>
                            </div>
                            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                              {formatRelativeTime(sub.created_at)}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {Object.entries(sub.data || {}).map(([key, val]) => (
                              <div key={key} className="bg-muted/50 rounded-lg p-2.5">
                                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">{key}</p>
                                <p className="text-xs font-medium truncate" title={String(val)}>
                                  {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                                </p>
                              </div>
                            ))}
                          </div>
                          
                          {sub.contact_id && (
                            <div className="mt-3 flex justify-end">
                              <button 
                                onClick={() => {
                                  setViewingSubmissions(null);
                                  router.push(`/tenant/contacts/${sub.contact_id}`);
                                }}
                                className="text-[11px] font-bold text-violet-600 hover:underline flex items-center gap-1"
                              >
                                View Contact Profile <ChevronRight className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="p-5 border-t border-border bg-muted/20">
                  <p className="text-xs text-muted-foreground text-center italic">Only the 50 most recent submissions are shown here.</p>
                </div>
              </div>
            </div>
          )}

          {/* Embed & Share instructions */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <h4 className="text-sm font-semibold">How to use forms</h4>
            
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">📋 Option 1: Share Link (Easiest)</p>
              <p className="text-xs text-muted-foreground mb-2">Click <ExternalLink className="w-3 h-3 inline" /> <strong>Share</strong> on any form to copy its public link. Share this URL with anyone — they can fill it out without logging in.</p>
            </div>
            
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">👁️ Option 2: View Form</p>
              <p className="text-xs text-muted-foreground mb-2">Click <Eye className="w-3 h-3 inline" /> <strong>View</strong> to open the form in a new tab. Perfect for testing or sharing directly.</p>
            </div>
            
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">💻 Option 3: Embed on Website</p>
              <p className="text-xs text-muted-foreground mb-2">Click <Copy className="w-3 h-3 inline" /> on any form to copy its embed code, then paste into your website:</p>
              <code className="text-xs bg-muted px-3 py-2 rounded-lg block font-mono text-muted-foreground">
                {'<script src="https://yourcrm.com/embed/form.js" data-form-id="FORM_ID"></script>'}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
