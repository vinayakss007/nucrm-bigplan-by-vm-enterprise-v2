/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

type Tab = 'field-permissions' | 'record-permissions' | 'approval-rules';

interface FieldPermission {
  id: string;
  roleId: string;
  roleName: string;
  entityType: string;
  fieldName: string;
  access: 'read' | 'write' | 'none';
}

interface RecordPermission {
  id: string;
  roleId: string;
  roleName: string;
  entityType: string;
  accessLevel: string;
}

interface ApprovalRule {
  id: string;
  name: string;
  entityType: string;
  conditions: Record<string, unknown>;
  approvers: string[];
  isActive: boolean;
}

export default function RBACSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('field-permissions');
  const [message] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  // #2872: each read now also hands back its own `refetch`, because the retry a
  // refused refresh needs has to re-run the read that was refused and not one of
  // the other two.
  const {
    data: fpData, isLoading: fpLoading, error: fpError, refetch: refetchFp,
  } = useApiQuery<{ data?: FieldPermission[] }>(
    ['tenant', 'rbac', 'field-permissions'],
    '/api/tenant/rbac/field-permissions',
    { retry: false },
  );
  const {
    data: rpData, isLoading: rpLoading, error: rpError, refetch: refetchRp,
  } = useApiQuery<{ data?: RecordPermission[] }>(
    ['tenant', 'rbac', 'record-permissions'],
    '/api/tenant/rbac/record-permissions',
    { retry: false },
  );
  const {
    data: arData, isLoading: arLoading, error: arError, refetch: refetchAr,
  } = useApiQuery<{ data?: ApprovalRule[] }>(
    ['tenant', 'rbac', 'approval-rules'],
    '/api/tenant/rbac/approval-rules',
    { retry: false },
  );
  const fieldPermissions: FieldPermission[] = fpData?.data ?? [];
  const recordPermissions: RecordPermission[] = rpData?.data ?? [];
  const approvalRules: ApprovalRule[] = arData?.data ?? [];

  // #2872: three reads, and each tab judged its own by one error flag. TanStack Query
  // keeps `data` when a revalidation of a read that already succeeded fails, so
  // `error ?` alone made "answered, then refused" look exactly like "never answered" —
  // and the other way round too: with rows in hand the refusal went unmentioned, while
  // a last read that legitimately held nothing got the outage card. `failed` is the
  // outage #2597 pinned; `stale` keeps the list and says it is the last read.
  // The status code and the words "endpoint"/"route" belong in `…Reason` (server
  // internals from `ApiQueryError.message`), never in the operator's banner copy below.
  const fpFailed = Boolean(fpError) && !fpData;
  const fpStale = Boolean(fpError) && Boolean(fpData);
  const fpReason = fpError?.message || 'no response from the server';
  const rpFailed = Boolean(rpError) && !rpData;
  const rpStale = Boolean(rpError) && Boolean(rpData);
  const rpReason = rpError?.message || 'no response from the server';
  const arFailed = Boolean(arError) && !arData;
  const arStale = Boolean(arError) && Boolean(arData);
  const arReason = arError?.message || 'no response from the server';

  // #2872: this was `fpLoading || rpLoading || arLoading` gating a whole-page
  // `Loading RBAC settings…` return, so two reads that had answered were replaced by a
  // spinner because the third had not — the tab navigation gone with them, and a read
  // that hangs is indistinguishable from a page that failed. Each tab now waits on its
  // own read only.
  const tabs: { id: Tab; label: string }[] = [
    { id: 'field-permissions', label: 'Field Permissions' },
    { id: 'record-permissions', label: 'Record Permissions' },
    { id: 'approval-rules', label: 'Approval Rules' },
  ];

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Access Control (RBAC)</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure granular field-level permissions, record access rules, and approval workflows.
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

      {/* Field Permissions Tab */}
      {activeTab === 'field-permissions' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Control which roles can read or write specific fields on each entity type.
          </p>
          {/* The refused refresh sits ABOVE the rows it did not replace (#2872). */}
          {fpStale && (
            <InlineErrorState
              message={`Could not refresh, so the field-level grants below are the last read: ${fpReason}. A field a role was just given or denied is not reflected here.`}
              onRetry={() => void refetchFp()}
            />
          )}
          {fpLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading field permissions…</p>
          ) : fpFailed ? (
            // #2597: a read that never answered is not an empty matrix. This sentence
            // is pinned by tests/unit/rbac-tab-error-state-2597.test.tsx.
            <InlineErrorState
              message={`Failed to load field permissions: ${fpReason}`}
              onRetry={() => void refetchFp()}
            />
          ) : fieldPermissions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Field</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {fieldPermissions.map(fp => (
                    <tr key={fp.id}>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{fp.roleName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{fp.entityType}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{fp.fieldName}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          fp.access === 'write' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          fp.access === 'read' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {fp.access}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No field permissions configured yet. Field permissions allow you to restrict which fields
                each role can see or edit.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Record Permissions Tab */}
      {activeTab === 'record-permissions' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Define which records each role can access based on ownership or team assignment.
          </p>
          {rpStale && (
            <InlineErrorState
              message={`Could not refresh, so the record access rules below are the last read: ${rpReason}. A rule you just added or removed is not reflected here.`}
              onRetry={() => void refetchRp()}
            />
          )}
          {rpLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading record permissions…</p>
          ) : rpFailed ? (
            // #2597: pinned by tests/unit/rbac-tab-error-state-2597.test.tsx.
            <InlineErrorState
              message={`Failed to load record permissions: ${rpReason}`}
              onRetry={() => void refetchRp()}
            />
          ) : recordPermissions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">Access Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {recordPermissions.map(rp => (
                    <tr key={rp.id}>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{rp.roleName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{rp.entityType}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">{rp.accessLevel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No record permissions configured yet. Record permissions control which records
                users can view based on ownership or sharing rules.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Approval Rules Tab */}
      {activeTab === 'approval-rules' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Configure approval workflows that require manager sign-off before changes take effect.
          </p>
          {arStale && (
            <InlineErrorState
              message={`Could not refresh, so the approval rules below are the last read: ${arReason}. A rule just created, edited or switched off is not reflected here.`}
              onRetry={() => void refetchAr()}
            />
          )}
          {arLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading approval rules…</p>
          ) : arFailed ? (
            // #2597: this endpoint is allowlisted as missing in
            // tests/unit/api-url-has-handler-2822.test.ts, so this arm is the tab's
            // everyday answer; the sentence keeps "none" and "unreadable" apart.
            <InlineErrorState
              message={`Failed to load approval rules: ${arReason}. An empty list here means the endpoint responded successfully with no rules; this message means it did not.`}
              onRetry={() => void refetchAr()}
            />
          ) : approvalRules.length > 0 ? (
            <div className="space-y-3">
              {approvalRules.map(rule => (
                <div key={rule.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{rule.name}</h4>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Entity: {rule.entityType} | Approvers: {rule.approvers.length}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No approval rules configured yet. Approval rules require specific actions to be
                approved before they take effect (e.g., deals above a certain value).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
