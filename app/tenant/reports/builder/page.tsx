'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const DATA_SOURCES = [
  { id: 'contacts', name: 'Contacts', fields: ['name', 'email', 'phone', 'company', 'status', 'source', 'createdAt'] },
  { id: 'deals', name: 'Deals', fields: ['title', 'value', 'stage', 'probability', 'owner', 'closedAt', 'createdAt'] },
  { id: 'companies', name: 'Companies', fields: ['name', 'domain', 'industry', 'size', 'revenue', 'createdAt'] },
  { id: 'tasks', name: 'Tasks', fields: ['title', 'status', 'priority', 'assignee', 'dueDate', 'completedAt', 'createdAt'] },
];

const CHART_TYPES = ['bar', 'line', 'pie', 'table'] as const;
type ChartType = typeof CHART_TYPES[number];

const OPERATORS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'];

interface Filter {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface ReportConfig {
  name: string;
  dataSource: string;
  columns: string[];
  filters: Filter[];
  chartType: ChartType;
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F'];

function SortableField({ id, onRemove }: { id: string; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-primary/10 px-3 py-1.5 rounded text-sm">
      <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground">⠿</span>
      <span className="flex-1">{id}</span>
      <button onClick={() => onRemove(id)} className="text-red-500 hover:text-red-700 text-xs">x</button>
    </div>
  );
}

function PreviewChart({ config, sampleData }: { config: ReportConfig; sampleData: any[] }) {
  if (sampleData.length === 0 || config.columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Select a data source and add columns to see a preview
      </div>
    );
  }

  if (config.chartType === 'table') {
    return (
      <div className="overflow-auto max-h-64">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              {config.columns.map(col => (
                <th key={col} className="text-left p-2 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleData.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                {config.columns.map(col => (
                  <td key={col} className="p-2">{row[col] ?? '-'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (config.chartType === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={sampleData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
            {sampleData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (config.chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={sampleData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={sampleData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" fill="#8884d8" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function ReportBuilderPage() {
  const [config, setConfig] = useState<ReportConfig>({
    name: '',
    dataSource: '',
    columns: [],
    filters: [],
    chartType: 'bar',
  });
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    async function loadReports() {
      try {
        const res = await fetch('/api/tenant/reports/builder');
        if (res.ok) {
          const { data } = await res.json();
          setSavedReports(data ?? []);
        }
      } catch { /* ignore */ }
    }
    loadReports();
  }, []);

  const currentSource = DATA_SOURCES.find(s => s.id === config.dataSource);
  const availableFields = currentSource?.fields.filter(f => !config.columns.includes(f)) ?? [];

  // Generate sample data for preview
  const sampleData = config.columns.length > 0 ? [
    { name: 'Jan', value: 12 },
    { name: 'Feb', value: 19 },
    { name: 'Mar', value: 8 },
    { name: 'Apr', value: 24 },
    { name: 'May', value: 15 },
  ] : [];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setConfig(prev => {
        const oldIndex = prev.columns.indexOf(active.id as string);
        const newIndex = prev.columns.indexOf(over.id as string);
        return { ...prev, columns: arrayMove(prev.columns, oldIndex, newIndex) };
      });
    }
  }

  function addColumn(field: string) {
    setConfig(prev => ({ ...prev, columns: [...prev.columns, field] }));
  }

  function removeColumn(field: string) {
    setConfig(prev => ({ ...prev, columns: prev.columns.filter(c => c !== field) }));
  }

  function addFilter() {
    const field = currentSource?.fields[0] ?? '';
    setConfig(prev => ({
      ...prev,
      filters: [...prev.filters, { id: crypto.randomUUID(), field, operator: 'equals', value: '' }],
    }));
  }

  function updateFilter(id: string, updates: Partial<Filter>) {
    setConfig(prev => ({
      ...prev,
      filters: prev.filters.map(f => f.id === id ? { ...f, ...updates } : f),
    }));
  }

  function removeFilter(id: string) {
    setConfig(prev => ({ ...prev, filters: prev.filters.filter(f => f.id !== id) }));
  }

  async function saveReport() {
    if (!config.name || !config.dataSource) {
      setMessage({ type: 'error', text: 'Name and data source are required' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant/reports/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: config.name, config }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setSavedReports(prev => [data, ...prev]);
        setMessage({ type: 'success', text: 'Report saved successfully' });
      } else {
        const { error } = await res.json();
        setMessage({ type: 'error', text: error || 'Failed to save report' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save report' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Report Builder</h1>
        <button
          onClick={saveReport}
          disabled={saving}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Report'}
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel - Configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Report Name */}
          <div className="admin-card p-4 space-y-3">
            <label className="text-sm font-medium">Report Name</label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => setConfig(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Monthly Sales Report"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          {/* Data Source */}
          <div className="admin-card p-4 space-y-3">
            <label className="text-sm font-medium">Data Source</label>
            <select
              value={config.dataSource}
              onChange={(e) => setConfig(prev => ({ ...prev, dataSource: e.target.value, columns: [], filters: [] }))}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">Select source...</option>
              {DATA_SOURCES.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Field Picker */}
          {currentSource && (
            <div className="admin-card p-4 space-y-3">
              <label className="text-sm font-medium">Available Fields</label>
              <div className="flex flex-wrap gap-1.5">
                {availableFields.map(field => (
                  <button
                    key={field}
                    onClick={() => addColumn(field)}
                    className="px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80 transition-colors"
                  >
                    + {field}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chart Type */}
          <div className="admin-card p-4 space-y-3">
            <label className="text-sm font-medium">Chart Type</label>
            <div className="grid grid-cols-4 gap-2">
              {CHART_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => setConfig(prev => ({ ...prev, chartType: type }))}
                  className={`p-2 text-center rounded border text-xs capitalize ${
                    config.chartType === type ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                  }`}
                >
                  {type === 'bar' && '📊'}
                  {type === 'line' && '📈'}
                  {type === 'pie' && '🥧'}
                  {type === 'table' && '📋'}
                  <br />{type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel - Selected columns + Preview */}
        <div className="lg:col-span-2 space-y-4">
          {/* Selected Columns (drag-drop) */}
          <div className="admin-card p-4 space-y-3">
            <label className="text-sm font-medium">Selected Columns (drag to reorder)</label>
            {config.columns.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={config.columns} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {config.columns.map(col => (
                      <SortableField key={col} id={col} onRemove={removeColumn} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <p className="text-sm text-muted-foreground">Click fields on the left to add them</p>
            )}
          </div>

          {/* Filters */}
          <div className="admin-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Filters</label>
              <button onClick={addFilter} disabled={!currentSource} className="text-xs text-primary hover:underline">
                + Add Filter
              </button>
            </div>
            {config.filters.length > 0 ? (
              <div className="space-y-2">
                {config.filters.map(filter => (
                  <div key={filter.id} className="flex gap-2 items-center">
                    <select
                      value={filter.field}
                      onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                      className="flex-1 px-2 py-1.5 border rounded text-xs"
                    >
                      {currentSource?.fields.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select
                      value={filter.operator}
                      onChange={(e) => updateFilter(filter.id, { operator: e.target.value })}
                      className="px-2 py-1.5 border rounded text-xs"
                    >
                      {OPERATORS.map(op => (
                        <option key={op} value={op}>{op.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={filter.value}
                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 border rounded text-xs"
                    />
                    <button onClick={() => removeFilter(filter.id)} className="text-red-500 text-xs px-1">x</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No filters applied</p>
            )}
          </div>

          {/* Preview */}
          <div className="admin-card p-4 space-y-3">
            <label className="text-sm font-medium">Preview</label>
            <PreviewChart config={config} sampleData={sampleData} />
          </div>
        </div>
      </div>

      {/* Saved Reports */}
      {savedReports.length > 0 && (
        <div className="admin-card p-4 space-y-3">
          <h2 className="text-sm font-medium">Saved Reports</h2>
          <div className="divide-y divide-border">
            {savedReports.map((report: any) => (
              <div key={report.id} className="py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{report.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.created_at ? new Date(report.created_at).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
