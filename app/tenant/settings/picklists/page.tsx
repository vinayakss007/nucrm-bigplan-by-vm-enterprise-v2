'use client';
import { useEffect, useState } from 'react';
import {
  ListChecks, Save, Loader2, Plus, X, Tag, ShieldX, GripVertical, RotateCcw,
  UserCheck, ThumbsDown, Trophy, ListTodo, Layers, Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Entry = { value: string; label: string; color?: string };
type Category = 'lead_sources' | 'loss_reasons' | 'win_reasons' | 'activity_types' | 'deal_types' | 'industries';

const CATEGORY_META: Array<{
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: Category; label: string; desc: string; icon: any;
}> = [
  { id: 'lead_sources',   label: 'Lead Sources',     desc: 'Where leads come from',                 icon: UserCheck },
  { id: 'loss_reasons',   label: 'Loss Reasons',     desc: 'Why deals are lost',                    icon: ThumbsDown },
  { id: 'win_reasons',    label: 'Win Reasons',      desc: 'Why deals are won',                     icon: Trophy },
  { id: 'activity_types', label: 'Activity Types',   desc: 'Logged activity categories',            icon: ListTodo },
  { id: 'deal_types',     label: 'Deal Types',       desc: 'New / Renewal / Expansion / Upsell',    icon: Layers },
  { id: 'industries',     label: 'Industries',       desc: 'Industry classification',               icon: Briefcase },
];

const COLOR_PALETTE = ['#7c3aed','#2563eb','#0891b2','#059669','#65a30d','#d97706','#dc2626','#db2777','#9333ea','#475569'];

export default function PicklistsPage() {
  const [data, setData] = useState<Record<Category, Entry[]> | null>(null);
  const [original, setOriginal] = useState<Record<Category, Entry[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [activeCat, setActiveCat] = useState<Category>('lead_sources');

  useEffect(() => {
  let ignore = false;
    Promise.all([
      fetch('/api/tenant/admin/picklists').then(r => r.ok ? r.json() : { picklists: null }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([d, me]: any[]) => { if (ignore) return; 
      setData(d.picklists ?? null);
      setOriginal(d.picklists ?? null);
      setIsAdmin(me?.is_admin ?? false);
     } ).finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const dirty = data && original && JSON.stringify(data) !== JSON.stringify(original);

  const updateEntry = (cat: Category, idx: number, patch: Partial<Entry>) => {
    setData(prev => {
      if (!prev) return prev;
      const copy = { ...prev, [cat]: [...prev[cat]] };
      copy[cat][idx] = { ...copy[cat][idx]!, ...patch };
      return copy;
    });
  };

  const addEntry = (cat: Category) => {
    setData(prev => {
      if (!prev) return prev;
      const copy = { ...prev, [cat]: [...prev[cat]] };
      copy[cat].push({ value: '', label: '' });
      return copy;
    });
  };

  const removeEntry = (cat: Category, idx: number) => {
    setData(prev => {
      if (!prev) return prev;
      const copy = { ...prev, [cat]: prev[cat].filter((_, i) => i !== idx) };
      return copy;
    });
  };

  const moveEntry = (cat: Category, idx: number, dir: -1 | 1) => {
    setData(prev => {
      if (!prev) return prev;
      const arr = [...prev[cat]];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target]!, arr[idx]!];
      return { ...prev, [cat]: arr };
    });
  };

  const save = async () => {
    if (!data) return;
    // Auto-derive value from label when the user left it blank
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleaned: Record<Category, Entry[]> = {} as any;
    for (const cat of Object.keys(data) as Category[]) {
      cleaned[cat] = data[cat]
        .map(e => ({
          value: e.value.trim() || e.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
          label: e.label.trim(),
          ...(e.color ? { color: e.color } : {}),
        }))
        .filter(e => e.value && e.label);
    }
    setSaving(true);
    const res = await fetch('/api/tenant/admin/picklists', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picklists: cleaned }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Picklists saved');
      setData(cleaned);
      setOriginal(cleaned);
    } else {
      toast.error(d.error || 'Failed');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">Picklists are editable by admins.</p>
      </div>
    </div>
  );

  if (!data) {
    return <div className="text-sm text-muted-foreground">Failed to load picklists.</div>;
  }

  const list = data[activeCat] ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><ListChecks className="w-5 h-5 text-violet-600" />Picklists</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the dropdown lists used everywhere in the workspace. Changes apply to existing records and new ones immediately.
        </p>
      </div>

      {/* Category picker */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_META.map(({ id, label, icon: Icon }) => {
          const active = activeCat === id;
          const count = data[id]?.length ?? 0;
          return (
            <button key={id} onClick={() => setActiveCat(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                active
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}>
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Active category editor */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              {(() => {
                const Icon = CATEGORY_META.find(c => c.id === activeCat)?.icon ?? ListChecks;
                return <Icon className="w-4 h-4 text-muted-foreground" />;
              })()}
              {CATEGORY_META.find(c => c.id === activeCat)?.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {CATEGORY_META.find(c => c.id === activeCat)?.desc}
            </p>
          </div>
          <button onClick={() => addEntry(activeCat)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add option
          </button>
        </div>

        <div className="space-y-1.5">
          {list.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No options. Click "Add option" to start.</p>
          )}
          {list.map((entry, idx) => (
            <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border bg-background hover:bg-accent/30 transition-colors">
              {/* Reorder */}
              <div className="flex flex-col text-muted-foreground/40">
                <button onClick={() => moveEntry(activeCat, idx, -1)} disabled={idx === 0}
                  className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed text-[10px] leading-none">▲</button>
                <button onClick={() => moveEntry(activeCat, idx, 1)} disabled={idx === list.length - 1}
                  className="hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed text-[10px] leading-none">▼</button>
              </div>

              {/* Color picker */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  className="w-5 h-5 rounded-md border border-border"
                  style={{ background: entry.color || '#94a3b8' }}
                  onClick={() => {
                    // Cycle through palette on click
                    const cur = entry.color || '#94a3b8';
                    const idx2 = COLOR_PALETTE.indexOf(cur);
                    const next = COLOR_PALETTE[(idx2 + 1) % COLOR_PALETTE.length];
                    updateEntry(activeCat, idx, { color: next });
                  }}
                  title="Click to change color"
                />
              </div>

              <input
                placeholder="Display label"
                value={entry.label}
                onChange={e => updateEntry(activeCat, idx, { label: e.target.value })}
                className="flex-1 min-w-0 px-2 py-1 rounded text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <input
                placeholder="value_slug (auto)"
                value={entry.value}
                onChange={e => updateEntry(activeCat, idx, { value: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 60) })}
                className="w-32 sm:w-40 px-2 py-1 rounded font-mono text-xs bg-muted/30 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <button onClick={() => removeEntry(activeCat, idx)}
                className="p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                title="Remove">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/70 px-1">
          Up to 100 options per list. The slug is auto-generated from the label if you leave it blank.
        </p>
      </div>

      {/* Save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setData(original)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          <RotateCcw className="w-3.5 h-3.5" /> Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save picklists'}
        </button>
      </div>
    </div>
  );
}
