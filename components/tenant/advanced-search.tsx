'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search, Filter, X, Save, Bookmark, ChevronDown, Calendar, DollarSign, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchFilters {
  status?: string[];
  stage?: string[];
  source?: string[];
  industry?: string[];
  priority?: string[];
  dateFrom?: string;
  dateTo?: string;
  valueMin?: number;
  valueMax?: number;
  tags?: string[];
}

interface SavedPreset {
  id: string;
  name: string;
  type: string;
  query: string;
  filters: SearchFilters;
}

interface AdvancedSearchProps {
  type: string;
  query: string;
  filters: SearchFilters;
  onQueryChange: (q: string) => void;
  onFiltersChange: (f: SearchFilters) => void;
  onSearch: () => void;
}

// ── Filter Options ───────────────────────────────────────────────────────────

const FILTER_OPTIONS: Record<string, { label: string; options: { value: string; label: string }[] }[]> = {
  contacts: [
    {
      label: 'Status',
      options: [
        { value: 'new', label: 'New' },
        { value: 'contacted', label: 'Contacted' },
        { value: 'qualified', label: 'Qualified' },
        { value: 'converted', label: 'Converted' },
        { value: 'unqualified', label: 'Unqualified' },
      ],
    },
    {
      label: 'Source',
      options: [
        { value: 'website', label: 'Website' },
        { value: 'referral', label: 'Referral' },
        { value: 'linkedin', label: 'LinkedIn' },
        { value: 'cold_outreach', label: 'Cold Outreach' },
        { value: 'event', label: 'Event' },
        { value: 'other', label: 'Other' },
      ],
    },
  ],
  deals: [
    {
      label: 'Stage',
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'qualified', label: 'Qualified' },
        { value: 'proposal', label: 'Proposal' },
        { value: 'negotiation', label: 'Negotiation' },
        { value: 'won', label: 'Won' },
        { value: 'lost', label: 'Lost' },
      ],
    },
  ],
  companies: [
    {
      label: 'Industry',
      options: [
        { value: 'technology', label: 'Technology' },
        { value: 'finance', label: 'Finance' },
        { value: 'healthcare', label: 'Healthcare' },
        { value: 'education', label: 'Education' },
        { value: 'retail', label: 'Retail' },
        { value: 'manufacturing', label: 'Manufacturing' },
        { value: 'consulting', label: 'Consulting' },
        { value: 'real_estate', label: 'Real Estate' },
        { value: 'other', label: 'Other' },
      ],
    },
  ],
  tasks: [
    {
      label: 'Priority',
      options: [
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low', label: 'Low' },
      ],
    },
  ],
};

// ── Main Component ───────────────────────────────────────────────────────────

export function AdvancedSearchFilters({ type, query, filters, onQueryChange, onFiltersChange, onSearch }: AdvancedSearchProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Load saved presets from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nucrm_search_presets');
      if (stored) setSavedPresets(JSON.parse(stored));
    } catch {}
  }, []);

  const activeFilterCount = Object.entries(filters).filter(([_, v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== '';
  }).length;

  const handleFilterToggle = (filterKey: string, value: string) => {
    const current = (filters as any)[filterKey] as string[] ?? [];
    const updated = current.includes(value)
      ? current.filter((v: string) => v !== value)
      : [...current, value];
    onFiltersChange({ ...filters, [filterKey]: updated.length > 0 ? updated : undefined });
  };

  const handleDateChange = (key: 'dateFrom' | 'dateTo', value: string) => {
    onFiltersChange({ ...filters, [key]: value || undefined });
  };

  const handleValueChange = (key: 'valueMin' | 'valueMax', value: string) => {
    const num = value ? Number(value) : undefined;
    onFiltersChange({ ...filters, [key]: num });
  };

  const clearAllFilters = () => {
    onFiltersChange({});
  };

  const savePreset = () => {
    if (!saveName.trim()) return;
    const preset: SavedPreset = {
      id: Date.now().toString(),
      name: saveName.trim(),
      type,
      query,
      filters,
    };
    const updated = [...savedPresets, preset];
    setSavedPresets(updated);
    localStorage.setItem('nucrm_search_presets', JSON.stringify(updated));
    setSaveName('');
    setShowSaveDialog(false);
  };

  const loadPreset = (preset: SavedPreset) => {
    onQueryChange(preset.query);
    onFiltersChange(preset.filters);
    setShowPresets(false);
  };

  const deletePreset = (id: string) => {
    const updated = savedPresets.filter(p => p.id !== id);
    setSavedPresets(updated);
    localStorage.setItem('nucrm_search_presets', JSON.stringify(updated));
  };

  const filterGroups = FILTER_OPTIONS[type] ?? [];
  const typePresets = savedPresets.filter(p => p.type === type);

  return (
    <div className="space-y-3">
      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all',
            showFilters || activeFilterCount > 0
              ? 'bg-violet-50 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
              : 'border-border hover:bg-accent'
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Saved presets */}
        <div className="relative">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-all"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Saved Views
            {typePresets.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-muted text-[9px] font-bold">{typePresets.length}</span>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showPresets && (
            <div className="absolute top-full mt-1 left-0 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
              {typePresets.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">No saved views yet</p>
              ) : (
                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                  {typePresets.map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors">
                      <button onClick={() => loadPreset(p)} className="flex-1 text-left text-xs font-medium truncate">
                        {p.name}
                      </button>
                      <button onClick={() => deletePreset(p.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save current */}
        {(query || activeFilterCount > 0) && (
          <div className="relative">
            {showSaveDialog ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder="View name..."
                  className="px-2 py-1.5 text-xs border border-border rounded-lg w-32 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setShowSaveDialog(false); }}
                  autoFocus
                />
                <button onClick={savePreset} className="px-2 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700">
                  Save
                </button>
                <button onClick={() => setShowSaveDialog(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                Save View
              </button>
            )}
          </div>
        )}

        {/* Clear all */}
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(filters).map(([key, value]) => {
            if (!value || (Array.isArray(value) && value.length === 0)) return null;
            if (Array.isArray(value)) {
              return value.map(v => (
                <span key={`${key}-${v}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] font-semibold">
                  <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: {v}</span>
                  <button onClick={() => handleFilterToggle(key, v)} className="hover:text-red-500">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ));
            }
            return (
              <span key={key} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] font-semibold">
                <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: {String(value)}</span>
                <button onClick={() => onFiltersChange({ ...filters, [key]: undefined })} className="hover:text-red-500">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="admin-card p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Category filters */}
            {filterGroups.map(group => (
              <div key={group.label}>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
                  {group.label}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {group.options.map(opt => {
                    const filterKey = group.label.toLowerCase() === 'status' ? 'status' :
                      group.label.toLowerCase() === 'stage' ? 'stage' :
                      group.label.toLowerCase() === 'source' ? 'source' :
                      group.label.toLowerCase() === 'industry' ? 'industry' :
                      group.label.toLowerCase() === 'priority' ? 'priority' : 'status';
                    const isActive = ((filters as any)[filterKey] as string[] ?? []).includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleFilterToggle(filterKey, opt.value)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all',
                          isActive
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'border-border hover:bg-accent'
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Date range */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Date Range
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.dateFrom ?? ''}
                  onChange={e => handleDateChange('dateFrom', e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-background"
                />
                <input
                  type="date"
                  value={filters.dateTo ?? ''}
                  onChange={e => handleDateChange('dateTo', e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-background"
                />
              </div>
            </div>

            {/* Value range (deals only) */}
            {type === 'deals' && (
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" /> Deal Value
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.valueMin ?? ''}
                    onChange={e => handleValueChange('valueMin', e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-background"
                  />
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.valueMax ?? ''}
                    onChange={e => handleValueChange('valueMax', e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-background"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <button
              onClick={onSearch}
              className="px-4 py-2 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
