'use client';

import { useState, useEffect } from 'react';

type Tab = 'retention' | 'gdpr' | 'soc2';

interface RetentionPolicy {
  id: string;
  entityType: string;
  retentionDays: number;
  action: string;
  isActive: boolean;
}

interface ComplianceRequest {
  id: string;
  type: string;
  status: string;
  requestedBy: string;
  completedAt: string | null;
  createdAt: string;
}

export default function ComplianceSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('retention');
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [gdprRequests, setGdprRequests] = useState<{ exports: ComplianceRequest[]; deletions: ComplianceRequest[] }>({ exports: [], deletions: [] });
  const [soc2Reports, setSoc2Reports] = useState<ComplianceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New retention policy form
  const [newPolicy, setNewPolicy] = useState({ entityType: 'contacts', retentionDays: 365, action: 'archive' });

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      try {
        const [retRes, gdprRes, soc2Res] = await Promise.all([
          fetch('/api/tenant/compliance/retention'),
          fetch('/api/tenant/compliance/gdpr'),
          fetch('/api/tenant/compliance/soc2'),
        ]);

        if (!ignore && retRes.ok) {
          const { data } = await retRes.json();
          setPolicies(data || []);
        }
        if (!ignore && gdprRes.ok) {
          const { data } = await gdprRes.json();
          setGdprRequests(data || { exports: [], deletions: [] });
        }
        if (!ignore && soc2Res.ok) {
          const { data } = await soc2Res.json();
          setSoc2Reports(data || []);
        }
      } catch {
        // Defaults on error
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadData();
    return () => { ignore = true; };
  }, []);

  async function createRetentionPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant/compliance/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPolicy),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Retention policy created.' });
        loadData();
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Failed to create policy' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  async function requestGDPR(type: 'export' | 'delete') {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant/compliance/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: type === 'export' ? 'Data export initiated.' : 'Deletion request submitted.' });
        loadData();
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Request failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  async function generateSOC2Report() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/tenant/compliance/soc2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: 90 }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'SOC 2 report generated successfully.' });
        loadData();
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Report generation failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading compliance settings...</div>;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'retention', label: 'Data Retention' },
    { id: 'gdpr', label: 'GDPR' },
    { id: 'soc2', label: 'SOC 2' },
  ];

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compliance</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage data retention policies, GDPR requests, and SOC 2 compliance reports.
        </p>
      </div>

      {message && (
        <div className={`rounded-md p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
          {message.text}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Data Retention Tab */}
      {activeTab === 'retention' && (
        <div className="space-y-6">
          <form onSubmit={createRetentionPolicy} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="mb-4 text-sm font-medium text-gray-900 dark:text-gray-100">New Retention Policy</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Entity Type</label>
                <select
                  value={newPolicy.entityType}
                  onChange={e => setNewPolicy(p => ({ ...p, entityType: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="contacts">Contacts</option>
                  <option value="deals">Deals</option>
                  <option value="activities">Activities</option>
                  <option value="emails">Emails</option>
                  <option value="audit_logs">Audit Logs</option>
                  <option value="notes">Notes</option>
                  <option value="tasks">Tasks</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Retention (days)</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={newPolicy.retentionDays}
                  onChange={e => setNewPolicy(p => ({ ...p, retentionDays: Number(e.target.value) }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Action</label>
                <select
                  value={newPolicy.action}
                  onChange={e => setNewPolicy(p => ({ ...p, action: e.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="archive">Archive</option>
                  <option value="delete">Delete</option>
                  <option value="anonymize">Anonymize</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="mt-4 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Policy'}
            </button>
          </form>

          {policies.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Retention</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {policies.map(p => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{p.entityType}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{p.retentionDays} days</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">{p.action}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* GDPR Tab */}
      {activeTab === 'gdpr' && (
        <div className="space-y-6">
          <div className="flex gap-3">
            <button
              onClick={() => requestGDPR('export')}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Request Data Export
            </button>
            <button
              onClick={() => requestGDPR('delete')}
              disabled={saving}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Request Data Deletion
            </button>
          </div>

          {(gdprRequests.exports.length > 0 || gdprRequests.deletions.length > 0) && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Past Requests</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Requested</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {[...gdprRequests.exports, ...gdprRequests.deletions].map(r => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{r.type}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'completed' ? 'bg-green-100 text-green-700' :
                            r.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{new Date(r.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{r.completedAt ? new Date(r.completedAt).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SOC 2 Tab */}
      {activeTab === 'soc2' && (
        <div className="space-y-6">
          <button
            onClick={generateSOC2Report}
            disabled={saving}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Generating...' : 'Generate SOC 2 Report'}
          </button>

          {soc2Reports.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Generated Reports</h3>
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Report</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Generated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {soc2Reports.map(r => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">SOC 2 Compliance Report</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'completed' ? 'bg-green-100 text-green-700' :
                            r.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{new Date(r.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
