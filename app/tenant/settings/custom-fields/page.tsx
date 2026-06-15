'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Settings,
  X,
  Check,
  Eye,
  Copy,
  Loader2,
  Search,
  ArrowUpDown,
  Tag,
  Database,
  Lightbulb,
  Code,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomField {
  id: string;
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  field_options?: string[];
  is_required: boolean;
  is_searchable: boolean;
  is_calculated: boolean;
  formula?: string;
  default_value?: string;
  display_order: number;
  created_at: string;
}

interface Feature {
  id: string;
  feature_name: string;
  description?: string;
  version: string;
  enabled: boolean;
  metadata_keys: string[];
  entities: string[];
  requires_tables: string[];
  registered_at: string;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TenantCustomFields() {
  const [entityType, setEntityType] = useState('contact');
  const [fields, setFields] = useState<CustomField[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const loadFields = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/custom-fields?entityType=${entityType}`);
      const data = await res.json();
      if (data.fields) setFields(data.fields);
    } catch (err) {
      console.error('Failed to load fields:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFeatures = async () => {
    try {
      const res = await fetch('/api/tenant/custom-fields?action=features');
      const data = await res.json();
      if (data.features) setFeatures(data.features);
    } catch (err) {
      console.error('Failed to load features:', err);
    }
  };

  useEffect(() => {
    loadFields();
    loadFeatures();
  }, [entityType, loadFields]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreate = async (fieldData: any) => {
    try {
      const res = await fetch('/api/tenant/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, ...fieldData }),
      });
      const data = await res.json();
      if (data.field) {
        setShowAddModal(false);
        loadFields();
      }
    } catch (err) {
      console.error('Failed to create field:', err);
    }
  };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdate = async (fieldData: any) => {
    if (!editingField) return;
    try {
      const res = await fetch('/api/tenant/custom-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldId: editingField.id, ...fieldData }),
      });
      const data = await res.json();
      if (data.field) {
        setShowEditModal(false);
        setEditingField(null);
        loadFields();
      }
    } catch (err) {
      console.error('Failed to update field:', err);
    }
  };

  const handleDelete = async (fieldId: string) => {
    try {
      await fetch(`/api/tenant/custom-fields?fieldId=${fieldId}`, { method: 'DELETE' });
      loadFields();
    } catch (err) {
      console.error('Failed to delete field:', err);
    }
  };

  useEffect(() => {
    loadFields();
    loadFeatures();
  }, [entityType, loadFields]);

  const ENTITY_TYPES = [
    { value: 'contact', label: 'Contacts', icon: '👤' },
    { value: 'deal', label: 'Deals', icon: '💰' },
    { value: 'company', label: 'Companies', icon: '🏢' },
    { value: 'lead', label: 'Leads', icon: '🎯' },
    { value: 'task', label: 'Tasks', icon: '✅' },
  ];

  const FIELD_TYPES = [
    { value: 'text', label: 'Text', example: 'Any text value' },
    { value: 'number', label: 'Number', example: '42, 3.14' },
    { value: 'date', label: 'Date', example: '2026-04-07' },
    { value: 'select', label: 'Dropdown', example: 'Pick one option' },
    { value: 'multiselect', label: 'Multi-Select', example: 'Pick multiple' },
    { value: 'boolean', label: 'Yes/No', example: 'true / false' },
    { value: 'url', label: 'URL', example: 'https://example.com' },
    { value: 'email', label: 'Email', example: 'user@example.com' },
    { value: 'phone', label: 'Phone', example: '+1-555-0123' },
    { value: 'currency', label: 'Currency', example: '$1,000.00' },
  ];

  return (
    <div className="p-6 mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-7 h-7 text-cyan-400" />
          Custom Fields
        </h1>
        <p className="text-gray-400 mt-1">
          Add fields to any entity — no code changes, no database migrations
        </p>
      </div>

      {/* Entity Type Tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit">
        {ENTITY_TYPES.map(et => (
          <button
            key={et.value}
            onClick={() => setEntityType(et.value)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              entityType === et.value
                ? 'bg-cyan-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <span>{et.icon}</span>
            {et.label}
          </button>
        ))}
      </div>

      {/* Info Banner */}
      <div className="bg-cyan-900/20 border border-cyan-800/50 rounded-xl p-4 flex items-start gap-3">
        <Lightbulb className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-cyan-300 font-medium">Dynamic Schema — Zero Migrations</h3>
          <p className="text-cyan-400/80 text-sm mt-1">
            Custom fields are stored in a JSONB column. Adding new fields is instant — no <code className="bg-cyan-900/50 px-1.5 py-0.5 rounded">ALTER TABLE</code> needed.
            Values are preserved even if you delete a field definition.
          </p>
        </div>
      </div>

      {/* Fields List */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          {ENTITY_TYPES.find(e => e.value === entityType)?.icon} {ENTITY_TYPES.find(e => e.value === entityType)?.label} — Custom Fields ({fields.length})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-1.5"
          >
            <Eye className="w-4 h-4" />
            Preview Data
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-2 text-sm bg-cyan-600 hover:bg-cyan-700 rounded-lg flex items-center gap-1.5 text-white font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Field
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-16 bg-gray-900 rounded-xl border border-gray-800">
          <Tag className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">No custom fields yet</p>
          <p className="text-gray-500 text-sm mt-1">Click "Add Field" to create your first custom field</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Required</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Searchable</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {fields.map((field, _i) => (
                <tr key={field.id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-sm text-gray-500 w-16">{field.display_order}</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{field.field_label}</td>
                  <td className="px-4 py-3">
                    <code className="px-2 py-0.5 bg-gray-800 rounded text-xs text-cyan-300 font-mono">
                      {field.field_key}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded text-xs capitalize">
                      {field.field_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {field.is_calculated ? (
                      <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 border border-purple-700 rounded text-[10px] font-bold uppercase tracking-wider">
                        Formula
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded text-[10px] font-bold uppercase tracking-wider">
                        Manual
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {field.is_required ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {field.is_searchable ? (
                      <Search className="w-4 h-4 text-blue-400" />
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingField(field); setShowEditModal(true); }}
                        className="p-1.5 hover:bg-gray-700 rounded"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4 text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleDelete(field.id)}
                        className="p-1.5 hover:bg-gray-700 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active Features */}
      {features.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4" />
            Active Features (auto-registered)
          </h3>
          <div className="flex flex-wrap gap-2">
            {features.filter(f => f.enabled).map(feature => (
              <div key={feature.id} className="px-3 py-2 bg-gray-800 rounded-lg text-sm flex items-center gap-2">
                <Code className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-white">{feature.feature_name}</span>
                <span className="text-gray-500">v{feature.version}</span>
                {feature.metadata_keys.length > 0 && (
                  <span className="text-gray-600">· {feature.metadata_keys.length} keys</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add Modal ─────────────────────────────────────────────────────── */}
      {showAddModal && (
        <FieldFormModal
          mode="add"
          fieldTypes={FIELD_TYPES}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* ── Edit Modal ────────────────────────────────────────────────────── */}
      {showEditModal && editingField && (
        <FieldFormModal
          mode="edit"
          field={editingField}
          fieldTypes={FIELD_TYPES}
          onClose={() => { setShowEditModal(false); setEditingField(null); }}
          onSubmit={handleUpdate}
        />
      )}

      {/* ── Preview Modal ─────────────────────────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-h-[80vh] overflow-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Eye className="w-5 h-5 text-cyan-400" />
                How Custom Fields Work
              </h3>
              <button onClick={() => setShowPreview(false)} className="p-1 hover:bg-gray-800 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-300">
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="text-white font-medium">1. You define a field:</p>
                <pre className="text-xs text-cyan-300">
{`POST /api/tenant/custom-fields
{
  "entityType": "contact",
  "fieldKey": "linkedin_url",
  "fieldLabel": "LinkedIn Profile",
  "fieldType": "url"
}`}
                </pre>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="text-white font-medium">2. Set a value (auto-stored in JSONB):</p>
                <pre className="text-xs text-green-300">
{`POST /api/tenant/custom-fields?action=set-value
{
  "entityType": "contact",
  "entityId": "abc-123",
  "fieldKey": "linkedin_url",
  "value": "https://linkedin.com/in/john"
}`}
                </pre>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="text-white font-medium">3. Register a feature (no migrations!):</p>
                <pre className="text-xs text-purple-300">
{`POST /api/tenant/custom-fields?action=register-feature
{
  "featureName": "ai_scoring",
  "metadataKeys": ["ai_score", "ai_sentiment"],
  "entities": ["contact", "lead"]
}`}
                </pre>
              </div>

              <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-3">
                <p className="text-amber-300">
                  <strong>Key point:</strong> All custom data is stored in the <code className="bg-amber-900/50 px-1.5 rounded">metadata</code> JSONB column.
                  No <code className="bg-amber-900/50 px-1.5 rounded">ALTER TABLE</code>. No migration files. No schema conflicts.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field Form Modal ─────────────────────────────────────────────────────────

function FieldFormModal({ mode, field, fieldTypes, onClose, onSubmit }: {
  mode: 'add' | 'edit';
  field?: CustomField;
  fieldTypes: { value: string; label: string; example: string }[];
  onClose: () => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSubmit: (data: any) => void;
}) {
  const [fieldKey, setFieldKey] = useState(field?.field_key || '');
  const [fieldLabel, setFieldLabel] = useState(field?.field_label || '');
  const [fieldType, setFieldType] = useState(field?.field_type || 'text');
  const [isRequired, setIsRequired] = useState(field?.is_required || false);
  const [isSearchable, setIsSearchable] = useState(field?.is_searchable !== false);
  const [isCalculated, setIsCalculated] = useState(field?.is_calculated || false);
  const [formula, setFormula] = useState(field?.formula || '');
  const [defaultValue, setDefaultValue] = useState(field?.default_value || '');
  const [displayOrder, setDisplayOrder] = useState(field?.display_order || 0);
  const [optionsText, setOptionsText] = useState(
    field?.field_options ? field.field_options.join('\n') : ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fieldOptions = (fieldType === 'select' || fieldType === 'multiselect')
      ? optionsText.split('\n').filter(o => o.trim())
      : undefined;

    onSubmit({
      ...(mode === 'edit' ? { fieldId: field?.id } : {}),
      fieldKey: fieldKey.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      fieldLabel,
      fieldType,
      fieldOptions,
      isRequired,
      isSearchable,
      isCalculated,
      formula: isCalculated ? formula : undefined,
      defaultValue: defaultValue || undefined,
      displayOrder,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {mode === 'add' ? 'Add Custom Field' : 'Edit Custom Field'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-sm text-gray-400 block mb-1">Field Label *</label>
              <input
                type="text"
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
                placeholder="e.g. LinkedIn Profile"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                required
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="text-sm text-gray-400 block mb-1">Field Key *</label>
              <input
                type="text"
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder="e.g. linkedin_url"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Field Type</label>
              <select
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {fieldTypes.map(ft => (
                  <option key={ft.value} value={ft.value}>{ft.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Display Order</label>
              <input
                type="number"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>

          <div className="p-4 bg-gray-950/50 border border-gray-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCalculated}
                  onChange={(e) => setIsCalculated(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-purple-500 bg-gray-800"
                />
                <span className="text-sm font-semibold text-purple-300">Calculated Field (Formula)</span>
              </label>
              <div className="px-2 py-0.5 bg-purple-900/30 text-purple-400 rounded text-[10px] font-bold uppercase">No-Code Logic</div>
            </div>

            {isCalculated ? (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <textarea
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                  placeholder="e.g. {{value}} * 0.1 or {{first_name}} + ' ' + {{last_name}}"
                  className="w-full px-3 py-2 bg-gray-900 border border-purple-900/50 rounded-lg text-cyan-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  rows={2}
                />
                <p className="text-[10px] text-gray-500">
                  Use <code className="text-purple-400">{'{{field_key}}'}</code> to reference other fields. Supports math and strings.
                </p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Manual entry fields are editable by users in the CRM.</p>
            )}
          </div>

          {(fieldType === 'select' || fieldType === 'multiselect') && (
            <div>
              <label className="text-sm text-gray-400 block mb-1">Options (one per line)</label>
              <textarea
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="Option 1&#10;Option 2"
                rows={3}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-cyan-500 bg-gray-800"
              />
              <span className="text-sm text-gray-300">Required</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isSearchable}
                onChange={(e) => setIsSearchable(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-cyan-500 bg-gray-800"
              />
              <span className="text-sm text-gray-300">Searchable</span>
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-white font-medium shadow-lg shadow-cyan-900/20"
            >
              {mode === 'add' ? 'Create Field' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
