/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('retention');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New retention policy form
  const [newPolicy, setNewPolicy] = useState({ entityType: 'contacts', retentionDays: 365, action: 'archive' });

  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  const {
    data: retData, isLoading: retLoading, error: retError, refetch: refetchRetention,
  } = useApiQuery<{ data?: RetentionPolicy[] }>(
    ['tenant', 'compliance', 'retention'],
    '/api/tenant/compliance/retention',
  );
  const {
    data: gdprData, isLoading: gdprLoading, error: gdprError, refetch: refetchGdpr,
  } = useApiQuery<{ data?: { exports: ComplianceRequest[]; deletions: ComplianceRequest[] } }>(
    ['tenant', 'compliance', 'gdpr'],
    '/api/tenant/compliance/gdpr',
  );
  const {
    data: soc2Data, isLoading: soc2Loading, error: soc2Error, refetch: refetchSoc2,
  } = useApiQuery<{ data?: ComplianceRequest[] }>(
    ['tenant', 'compliance', 'soc2'],
    '/api/tenant/compliance/soc2',
  );
  const policies: RetentionPolicy[] = retData?.data ?? [];
  const gdprRequests = gdprData?.data ?? { exports: [], deletions: [] };
  const soc2Reports: ComplianceRequest[] = soc2Data?.data ?? [];
  const loading = retLoading || gdprLoading || soc2Loading;

  // #2872: these three reads used to bind `data` and nothing else, so a failure had
  // no channel at all — the tab rendered its create form over an absent table, and
  // "no policies", "no requests" and "no reports" were indistinguishable from three
  // reads that never answered. The refused half is the routine one on this page: all
  // three writes finish with `invalidate(<key>)` on the exact key of the read feeding
  // the tab the operator is standing in, so the reload that fails lands right after
  // Create Policy / Request Export / Generate Report, and TanStack Query hands `data`
  // back through it (staleTime 30s, retry 2) — kept rows, error flag set, no mention
  // anywhere that the row just written may not be the one on screen.
  // Nothing here is gated: no write replaces a whole array or map. Retention POST
  // inserts one row (and the route 409s a duplicate entity type — a collision the
  // server can and does refuse), and the GDPR and SOC 2 POSTs append a request row
  // whose payload comes from the button, not from the read, so a save over an unread
  // read cannot clobber what the read did not show.
  const retFailed = Boolean(retError) && !retData;
  const retStale = Boolean(retError) && Boolean(retData);
  const retReason = retError?.message || 'no response from the server';
  const gdprFailed = Boolean(gdprError) && !gdprData;
  const gdprStale = Boolean(gdprError) && Boolean(gdprData);
  const gdprReason = gdprError?.message || 'no response from the server';
  const soc2Failed = Boolean(soc2Error) && !soc2Data;
  const soc2Stale = Boolean(soc2Error) && Boolean(soc2Data);
  const soc2Reason = soc2Error?.message || 'no response from the server';

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: ['tenant', 'compliance', key] });

  const retentionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/compliance/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPolicy),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create policy');
    },
    onSuccess: () => { setMessage({ type: 'success', text: 'Retention policy created.' }); invalidate('retention'); },
    onError: (e: Error) => setMessage({ type: 'error', text: e.message || 'Network error' }),
  });

  const gdprMutation = useMutation({
    mutationFn: async (type: 'export' | 'delete') => {
      const res = await fetch('/api/tenant/compliance/gdpr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
      return type;
    },
    onSuccess: (type) => { setMessage({ type: 'success', text: type === 'export' ? 'Data export initiated.' : 'Deletion request submitted.' }); invalidate('gdpr'); },
    onError: (e: Error) => setMessage({ type: 'error', text: e.message || 'Network error' }),
  });

  const soc2Mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/compliance/soc2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: 90 }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Report generation failed');
    },
    onSuccess: () => { setMessage({ type: 'success', text: 'SOC 2 report generated successfully.' }); invalidate('soc2'); },
    onError: (e: Error) => setMessage({ type: 'error', text: e.message || 'Network error' }),
  });

  const saving = retentionMutation.isPending || gdprMutation.isPending || soc2Mutation.isPending;

  function createRetentionPolicy(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    retentionMutation.mutate();
  }
  function requestGDPR(type: 'export' | 'delete') {
    setMessage(null);
    gdprMutation.mutate(type);
  }
  function generateSOC2Report() {
    setMessage(null);
    soc2Mutation.mutate();
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
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
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
          {retFailed && (
            <InlineErrorState
              message={`Could not load the retention policies: ${retReason}. An absent list below means this read failed, not that no policy is set.`}
              onRetry={() => void refetchRetention()}
            />
          )}
          {retStale && (
            <InlineErrorState
              message={`Could not refresh, so the retention policies below are the last read: ${retReason}. The policy you just created is not in this list, and one another admin changed in the same window still shows the way this page last saw it.`}
              onRetry={() => void refetchRetention()}
            />
          )}
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Retention</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {policies.map(p => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{p.entityType}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{p.retentionDays} days</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">{p.action}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
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
          {gdprFailed && (
            <InlineErrorState
              message={`Could not load the GDPR request log: ${gdprReason}. Nothing listed below means this read failed, not that the tenant has never filed an export or an erasure.`}
              onRetry={() => void refetchGdpr()}
            />
          )}
          {gdprStale && (
            <InlineErrorState
              message={`Could not refresh, so the GDPR requests below are the last read: ${gdprReason}. The export or erasure you just submitted is not in this list, and a stalled request the server would reap as failed on its next read still shows as running here.`}
              onRetry={() => void refetchGdpr()}
            />
          )}
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Requested</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {[...gdprRequests.exports, ...gdprRequests.deletions].map(r => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{r.type}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            r.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
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
          {soc2Failed && (
            <InlineErrorState
              message={`Could not load the SOC 2 report history: ${soc2Reason}. Nothing listed below means this read failed, not a tenant that has never generated a report.`}
              onRetry={() => void refetchSoc2()}
            />
          )}
          {soc2Stale && (
            <InlineErrorState
              message={`Could not refresh, so the reports below are the last read: ${soc2Reason}. The report you just generated is not in this list, and a generation the server would now reap as failed still shows as running.`}
              onRetry={() => void refetchSoc2()}
            />
          )}
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Report</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Generated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {soc2Reports.map(r => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">SOC 2 Compliance Report</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            r.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
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
