'use client';

import { useState, useEffect } from 'react';

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
  conditions: Record<string, any>;
  approvers: string[];
  isActive: boolean;
}

export default function RBACSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('field-permissions');
  const [fieldPermissions, setFieldPermissions] = useState<FieldPermission[]>([]);
  const [recordPermissions, setRecordPermissions] = useState<RecordPermission[]>([]);
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      try {
        const [fpRes, rpRes, arRes] = await Promise.all([
        fetch('/api/tenant/rbac/field-permissions').catch(e => { console.error('[rbac]', e); return null; }),
        fetch('/api/tenant/rbac/record-permissions').catch(e => { console.error('[rbac]', e); return null; }),
        fetch('/api/tenant/rbac/approval-rules').catch(e => { console.error('[rbac]', e); return null; }),
        ]);

        if (!ignore && fpRes?.ok) {
          const { data } = await fpRes.json();
          setFieldPermissions(data || []);
        }
        if (!ignore && rpRes?.ok) {
          const { data } = await rpRes.json();
          setRecordPermissions(data || []);
        }
        if (!ignore && arRes?.ok) {
          const { data } = await arRes.json();
          setApprovalRules(data || []);
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

  if (loading) {
    return <div className="p-6">Loading RBAC settings...</div>;
  }

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
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400'
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
          {fieldPermissions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Field</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Access</th>
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
                          fp.access === 'write' ? 'bg-green-100 text-green-700' :
                          fp.access === 'read' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
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
          {recordPermissions.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Access Level</th>
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
          {approvalRules.length > 0 ? (
            <div className="space-y-3">
              {approvalRules.map(rule => (
                <div key={rule.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{rule.name}</h4>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
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
