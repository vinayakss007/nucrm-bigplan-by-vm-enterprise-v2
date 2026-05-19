'use client';
import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  onSave: (value: string) => Promise<void>;
  type?: 'text' | 'select';
  options?: { value: string; label: string }[];
  className?: string;
}

export function InlineEdit({ value, onSave, type = 'text', options, className = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && type === 'text') inputRef.current?.focus();
    if (editing && type === 'select') selectRef.current?.focus();
  }, [editing]);

  const save = async () => {
    if (draft === value || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
    } catch { setDraft(value); }
    setSaving(false);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span onClick={() => { setDraft(value); setEditing(true); }}
        className={`cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 transition-colors ${className}`}>
        {value || <span className="text-muted-foreground/40 italic">Empty</span>}
      </span>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={selectRef} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
        className="w-full px-1.5 py-0.5 rounded border border-violet-500 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        autoFocus>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input ref={inputRef} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
      className="w-full px-1.5 py-0.5 rounded border border-violet-500 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
    />
  );
}
