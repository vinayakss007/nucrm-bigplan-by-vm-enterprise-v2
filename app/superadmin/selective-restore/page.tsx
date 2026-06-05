'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Database,
  Upload,
  Search,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  X,
  RefreshCw,
  Trash2,
  Eye,
  ArrowRight,
  Loader2,
  FileText,
  Shield,
  RotateCcw,
  Clock,
  Users,
  Table2,
  Play,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface BackupFile {
  id: string;
  file_name: string;
  file_size: number;
  file_size_formatted: string;
  backup_type: string;
  parse_status: 'pending' | 'completed' | 'failed';
  tenants_included?: any[];
  total_record_count?: number;
  tables_available?: string[];
  backup_date_range?: { earliest: string; latest: string };
  uploaded_at: string;
  uploaded_by_name?: string;
}

interface TenantInfo {
  tenant_id: string;
  tenant_name?: string;
  record_counts: Record<string, number>;
  total_records: number;
  tables: string[];
}

interface ScopePreview {
  tenant: any;
  backup_file: string;
  restore_mode: string;
  tables_selected: string[];
  summary: {
    total_records_in_backup: number;
    total_existing_records: number;
    estimated_new_records: number;
    estimated_updated_records: number;
    estimated_skipped_records: number;
  };
  per_table: Record<string, { from_backup: number; existing: number; new: number; updated: number; skipped: number }>;
  warnings: string[];
}

interface RestoreLog {
  id: string;
  backup_id: string;
  target_tenant_id: string;
  status: string;
  restore_mode: string;
  tables_selected: any;
  records_affected?: any;
  records_per_table?: any;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  error_message?: string;
  tenant_name?: string;
  tenant_slug?: string;
  backup_file_name?: string;
  performed_by_name?: string;
}

interface TenantUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
}

type Step = 'upload' | 'preview' | 'user-select' | 'select' | 'scope' | 'execute' | 'done';

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SelectiveRestorePage() {
  const [step, setStep] = useState<Step>('upload');
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupFile | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<TenantInfo | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [restoreMode, setRestoreMode] = useState<'insert_only' | 'upsert' | 'replace'>('insert_only');
  const [scopePreview, setScopePreview] = useState<ScopePreview | null>(null);
  const [restoreProgress, setRestoreProgress] = useState<any>(null);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [restoreLogs, setRestoreLogs] = useState<RestoreLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load data on mount
  useEffect(() => {
    loadBackups();
    loadRestoreLogs();
  }, []);

  const loadBackups = async () => {
    try {
      const res = await fetch('/api/superadmin/selective-restore/backups');
      const data = await res.json();
      if (data.backups) setBackups(data.backups);
    } catch (err) {
      console.error('Failed to load backups:', err);
    }
  };

  const loadRestoreLogs = async () => {
    try {
      const res = await fetch('/api/superadmin/selective-restore/logs');
      const data = await res.json();
      if (data.logs) setRestoreLogs(data.logs);
    } catch (err) {
      console.error('Failed to load restore logs:', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('backup_type', 'full');

      const res = await fetch('/api/superadmin/selective-restore/backups', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        await loadBackups();
        // Wait for parsing then preview
        await pollForParseCompletion(data.backup_id);
      } else {
        alert('Upload failed: ' + data.error);
      }
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const pollForParseCompletion = async (backupId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch('/api/superadmin/selective-restore/backups');
        const data = await res.json();
        const backup = data.backups?.find((b: any) => b.id === backupId);
        if (backup?.parse_status === 'completed') {
          setSelectedBackup(backup);
          setStep('preview');
          return;
        }
        if (backup?.parse_status === 'failed') {
          alert('Backup parsing failed: ' + backup.parse_error);
          return;
        }
      } catch {}
    }
    alert('Parsing timed out. Please try again later.');
  };

  const handlePreviewBackup = async (backup: BackupFile) => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/selective-restore/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_id: backup.id }),
      });
      const data = await res.json();
      setSelectedBackup(backup);
      setSelectedTenant(null);
      setSelectedTables([]);
      setStep('preview');
    } catch (err: any) {
      alert('Preview failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTenant = async (tenant: TenantInfo) => {
    setSelectedTenant(tenant);
    setSelectedTables([]);
    setSelectedUserId(null);
    setLoadingUsers(true);
    setStep('user-select');

    try {
      const res = await fetch(`/api/superadmin/selective-restore/users?tenant_id=${tenant.tenant_id}`);
      const data = await res.json();
      if (data.users) {
        setTenantUsers(data.users);
      } else {
        setTenantUsers([]);
      }
    } catch (err) {
      console.error('Failed to load tenant users:', err);
      setTenantUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSelectUser = (userId: string | null) => {
    setSelectedUserId(userId);
    setStep('select');
  };

  const handleToggleTable = (table: string) => {
    setSelectedTables(prev =>
      prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]
    );
  };

  const handleSelectAllTables = () => {
    if (selectedTenant) {
      setSelectedTables(selectedTenant.tables);
    }
  };

  const handleGetScopePreview = async () => {
    if (!selectedBackup || !selectedTenant || selectedTables.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/selective-restore/scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backup_id: selectedBackup.id,
          tenant_id: selectedTenant.tenant_id,
          tables: selectedTables,
          restore_mode: restoreMode,
          ...(selectedUserId ? { user_id: selectedUserId } : {}),
        }),
      });
      const data = await res.json();
      setScopePreview(data);
      setStep('scope');
    } catch (err: any) {
      alert('Scope preview failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteRestore = async () => {
    if (!selectedBackup || !selectedTenant) return;

    setLoading(true);
    setStep('execute');
    setRestoreProgress({ step: 'starting', status: 'running', message: 'Initializing restore...' });

    try {
      const res = await fetch('/api/superadmin/selective-restore/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backup_id: selectedBackup.id,
          tenant_id: selectedTenant.tenant_id,
          tables: selectedTables,
          restore_mode: restoreMode,
          confirm_restore: restoreMode === 'replace',
          ...(selectedUserId ? { user_id: selectedUserId } : {}),
        }),
      });

      // Read SSE stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error('No response stream');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              setRestoreProgress(data);
              
              if (data.step === 'complete') {
                setRestoreResult(data);
                setStep('done');
                loadRestoreLogs();
                return;
              }
              if (data.step === 'error') {
                setRestoreResult(data);
                setStep('done');
                return;
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setRestoreProgress({ step: 'failed', status: 'failed', message: err.message });
      setRestoreResult({ success: false, error: err.message });
      setStep('done');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setSelectedBackup(null);
    setSelectedTenant(null);
    setSelectedTables([]);
    setSelectedUserId(null);
    setTenantUsers([]);
    setScopePreview(null);
    setRestoreProgress(null);
    setRestoreResult(null);
  };

  const handleDeleteBackup = async (backupId: string) => {
    try {
      await fetch(`/api/superadmin/selective-restore/backups?id=${backupId}`, { method: 'DELETE' });
      loadBackups();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const formatTimeAgo = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // ── Steps Navigation ──────────────────────────────────────────────────────
  const steps = [
    { id: 'upload' as Step, label: 'Upload', icon: Upload },
    { id: 'preview' as Step, label: 'Tenants', icon: Eye },
    { id: 'user-select' as Step, label: 'Users', icon: Users },
    { id: 'select' as Step, label: 'Tables', icon: Table2 },
    { id: 'scope' as Step, label: 'Scope', icon: Search },
    { id: 'execute' as Step, label: 'Execute', icon: Play },
  ];

  const stepIndex = steps.findIndex(s => s.id === step);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-7 h-7 text-green-400" />
            Selective Tenant Restore
          </h1>
          <p className="text-gray-400 mt-1">Restore data for a single tenant from SQL backups without affecting others</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-medium flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            Restore History
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium flex items-center gap-2"
          >
            New Restore
          </button>
        </div>
      </div>

      {/* Steps Progress */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm ${
              i < stepIndex ? 'bg-green-900/50 text-green-300' :
              i === stepIndex ? 'bg-blue-600 text-white' :
              'bg-gray-800 text-gray-500'
            }`}>
              <s.icon className="w-4 h-4" />
              {s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight className="w-4 h-4 text-gray-600 mx-1" />}
          </div>
        ))}
      </div>

      {/* Restore History Panel */}
      {showLogs && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Restore History
          </h3>
          {restoreLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No restore operations yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tenant</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tables</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {restoreLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-sm text-gray-300">{log.tenant_name || log.target_tenant_id?.slice(0, 8)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-400 capitalize">{log.restore_mode}</td>
                      <td className="px-3 py-2 text-sm text-gray-400">{Array.isArray(log.tables_selected) ? log.tables_selected.length : '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-400">{log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatTimeAgo(log.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: Upload / Select Backup ───────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-6">
          {/* Upload Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-xl p-12 text-center cursor-pointer transition-colors bg-gray-900/50"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,.sql.gz"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Upload className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-white font-medium">Upload SQL Backup File</p>
            <p className="text-gray-500 text-sm mt-1">.sql or .sql.gz files up to 2GB</p>
            {loading && (
              <div className="mt-4 flex items-center justify-center gap-2 text-blue-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading and parsing...
              </div>
            )}
          </div>

          {/* Available Backups */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Available Backups</h2>
            {backups.length === 0 ? (
              <div className="text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
                <Database className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No backups uploaded yet</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {backups.map(backup => (
                  <div key={backup.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-lg ${
                        backup.parse_status === 'completed' ? 'bg-green-900/50' :
                        backup.parse_status === 'failed' ? 'bg-red-900/50' :
                        'bg-amber-900/50'
                      }`}>
                        <FileText className={`w-5 h-5 ${
                          backup.parse_status === 'completed' ? 'text-green-400' :
                          backup.parse_status === 'failed' ? 'text-red-400' :
                          'text-amber-400'
                        }`} />
                      </div>
                      <div>
                        <p className="text-white font-medium">{backup.file_name}</p>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                          <span>{backup.file_size_formatted}</span>
                          <span>•</span>
                          <span>{backup.total_record_count?.toLocaleString() || 0} records</span>
                          <span>•</span>
                          <span>{backup.tenants_included?.length || 0} tenants</span>
                          <span>•</span>
                          <span>{formatTimeAgo(backup.uploaded_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={backup.parse_status} />
                      {backup.parse_status === 'completed' && (
                        <button
                          onClick={() => handlePreviewBackup(backup)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white flex items-center gap-1"
                        >
                          <Eye className="w-4 h-4" />
                          Preview
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBackup(backup.id)}
                        className="p-1.5 hover:bg-red-900/50 rounded-lg text-gray-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Preview Backup Tenants ───────────────────────────────── */}
      {step === 'preview' && selectedBackup && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Backup: {selectedBackup.file_name}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="File Size" value={selectedBackup.file_size_formatted} />
              <StatCard label="Total Records" value={selectedBackup.total_record_count?.toLocaleString() || '0'} />
              <StatCard label="Tenants Found" value={String(selectedBackup.tenants_included?.length || 0)} />
              <StatCard label="Tables" value={String(selectedBackup.tables_available?.length || 0)} />
            </div>

            <h3 className="text-md font-semibold text-white mb-3">Tenants in Backup</h3>
            {selectedBackup.tenants_included && selectedBackup.tenants_included.length > 0 ? (
              <div className="grid gap-3">
                {selectedBackup.tenants_included.map((tenant: TenantInfo) => (
                  <button
                    key={tenant.tenant_id}
                    onClick={() => handleSelectTenant(tenant)}
                    className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl p-4 text-left transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium">{tenant.tenant_name || 'Unknown Tenant'}</p>
                        <p className="text-gray-500 text-xs font-mono mt-1">{tenant.tenant_id.slice(0, 8)}...</p>
                      </div>
                      <div className="text-right">
                        <p className="text-blue-400 font-medium">{tenant.total_records.toLocaleString()} records</p>
                        <p className="text-gray-500 text-sm">{tenant.tables.length} tables</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {Object.entries(tenant.record_counts).slice(0, 6).map(([table, count]) => (
                        <span key={table} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
                          {table}: {count}
                        </span>
                      ))}
                      {Object.keys(tenant.record_counts).length > 6 && (
                        <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
                          +{Object.keys(tenant.record_counts).length - 6} more
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No tenants found in this backup</p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2b: User Selection ─────────────────────────────────────── */}
      {step === 'user-select' && selectedTenant && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-2">
              Select User Scope
            </h2>
            <p className="text-gray-400 mb-6">
              Tenant: {selectedTenant.tenant_name || 'Unknown'} - Choose to restore all users or filter by a specific user
            </p>

            {loadingUsers ? (
              <div className="flex items-center justify-center py-12 gap-3 text-blue-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading users...</span>
              </div>
            ) : (
              <div className="grid gap-3">
                {/* All Users option */}
                <button
                  onClick={() => handleSelectUser(null)}
                  className="bg-gray-800 hover:border-blue-500 border-2 border-gray-700 rounded-xl p-5 text-left transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-lg bg-blue-900/50">
                        <Users className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-white font-semibold text-base">All Users (Full Tenant Restore)</p>
                        <p className="text-gray-400 text-sm mt-0.5">Restore data for all users in this tenant</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  </div>
                </button>

                {/* Individual users */}
                {tenantUsers.map(user => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user.id)}
                    className="bg-gray-800 hover:border-gray-600 border border-gray-700 rounded-xl p-4 text-left transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-2.5 rounded-lg bg-gray-700">
                          <Shield className="w-4 h-4 text-gray-300" />
                        </div>
                        <div>
                          <p className="text-white font-medium">{user.fullName || 'Unnamed User'}</p>
                          <p className="text-gray-400 text-sm">{user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 bg-gray-700 rounded text-xs font-medium text-gray-300 capitalize">
                          {user.role}
                        </span>
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      </div>
                    </div>
                  </button>
                ))}

                {tenantUsers.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>No active users found for this tenant.</p>
                    <p className="text-sm mt-1">You can still proceed with a full tenant restore.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Select Tables ────────────────────────────────────────── */}
      {step === 'select' && selectedTenant && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-2">
              Select Tables to Restore
            </h2>
            <p className="text-gray-400 mb-4">
              Tenant: {selectedTenant.tenant_name || 'Unknown'} ({selectedTenant.total_records.toLocaleString()} records available)
              {selectedUserId && tenantUsers.length > 0 && (
                <span className="text-blue-400 ml-2">
                  | User: {tenantUsers.find(u => u.id === selectedUserId)?.fullName || tenantUsers.find(u => u.id === selectedUserId)?.email || 'Selected'}
                </span>
              )}
            </p>

            {/* Restore Mode */}
            <div className="mb-6 p-4 bg-gray-800 rounded-lg">
              <label className="text-sm font-medium text-white mb-2 block">Restore Mode</label>
              <div className="flex gap-3">
                {[
                  { value: 'insert_only' as const, label: 'Insert Only', desc: 'Skip existing records' },
                  { value: 'upsert' as const, label: 'Upsert', desc: 'Update existing, insert new' },
                  { value: 'replace' as const, label: 'Replace', desc: '⚠️ Delete existing, then insert' },
                ].map(mode => (
                  <button
                    key={mode.value}
                    onClick={() => setRestoreMode(mode.value)}
                    className={`flex-1 p-3 rounded-lg border text-left ${
                      restoreMode === mode.value
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-gray-700 bg-gray-900 hover:border-gray-600'
                    }`}
                  >
                    <p className="text-white font-medium text-sm">{mode.label}</p>
                    <p className="text-gray-500 text-xs">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Table Selection */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-400">Tables</h3>
              <button
                onClick={handleSelectAllTables}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Select All
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
              {selectedTenant.tables.map(table => {
                const count = selectedTenant.record_counts[table] || 0;
                const isSelected = selectedTables.includes(table);
                return (
                  <button
                    key={table}
                    onClick={() => handleToggleTable(table)}
                    className={`p-3 rounded-lg border text-left flex items-center justify-between ${
                      isSelected
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <span className="text-white text-sm">{table}</span>
                    <span className="text-gray-400 text-xs">{count.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>

            {/* Next Button */}
            <div className="flex justify-end mt-6">
              <button
                onClick={handleGetScopePreview}
                disabled={selectedTables.length === 0}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-white font-medium flex items-center gap-2"
              >
                Preview Scope
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Scope Preview ────────────────────────────────────────── */}
      {step === 'scope' && scopePreview && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Restore Scope Preview</h2>

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard label="From Backup" value={scopePreview.summary.total_records_in_backup.toLocaleString()} />
              <StatCard label="Existing in DB" value={scopePreview.summary.total_existing_records.toLocaleString()} />
              <StatCard label="Will Insert" value={scopePreview.summary.estimated_new_records.toLocaleString()} />
              <StatCard label="Will Update" value={scopePreview.summary.estimated_updated_records.toLocaleString()} />
            </div>

            {/* Warnings */}
            {scopePreview.warnings.length > 0 && (
              <div className="mb-6 p-4 bg-amber-900/20 border border-amber-800/50 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-amber-300 font-medium">Warnings</h4>
                    <ul className="text-amber-400/80 text-sm mt-2 space-y-1">
                      {scopePreview.warnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Per Table Breakdown */}
            <h3 className="text-sm font-medium text-gray-400 mb-3">Per-Table Breakdown</h3>
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Table</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">From Backup</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Existing</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Will Insert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {Object.entries(scopePreview.per_table).map(([table, data]) => (
                    <tr key={table} className="hover:bg-gray-700/30">
                      <td className="px-4 py-2 text-sm text-white font-mono">{table}</td>
                      <td className="px-4 py-2 text-sm text-blue-400">{data.from_backup.toLocaleString()}</td>
                      <td className="px-4 py-2 text-sm text-gray-400">{data.existing.toLocaleString()}</td>
                      <td className="px-4 py-2 text-sm text-green-400">{data.new.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Execute Button */}
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => setStep('select')}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white font-medium"
              >
                Back
              </button>
              <button
                onClick={handleExecuteRestore}
                className={`px-6 py-2.5 rounded-lg text-white font-medium flex items-center gap-2 ${
                  restoreMode === 'replace'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                <Play className="w-4 h-4" />
                {restoreMode === 'replace' ? '⚠️ Execute Replace' : 'Execute Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 5: Execute Progress ─────────────────────────────────────── */}
      {(step === 'execute' || step === 'done') && restoreProgress && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {step === 'done' ? 'Restore Complete' : 'Restore In Progress'}
            </h2>

            {/* Progress Indicator */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-2">
                {restoreProgress.status === 'running' && (
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                )}
                {restoreProgress.status === 'completed' && (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                )}
                {restoreProgress.status === 'failed' && (
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                )}
                <span className="text-white font-medium">{restoreProgress.message}</span>
              </div>

              {/* Progress Bar */}
              {restoreProgress.totalCount > 0 && (
                <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      restoreProgress.status === 'completed' ? 'bg-green-500' :
                      restoreProgress.status === 'failed' ? 'bg-red-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${(restoreProgress.currentCount / restoreProgress.totalCount) * 100}%` }}
                  />
                </div>
              )}

              {restoreProgress.totalCount > 0 && (
                <p className="text-gray-500 text-sm mt-2">
                  {restoreProgress.currentCount.toLocaleString()} / {restoreProgress.totalCount.toLocaleString()} statements
                  {restoreProgress.currentTable && ` (${restoreProgress.currentTable})`}
                </p>
              )}
            </div>

            {/* Result */}
            {restoreResult && (
              <div className={`p-4 rounded-lg ${
                restoreResult.success ? 'bg-green-900/30 border border-green-800/50' : 'bg-red-900/30 border border-red-800/50'
              }`}>
                {restoreResult.success ? (
                  <div>
                    <p className="text-green-300 font-medium">Restore completed successfully</p>
                    <p className="text-green-400/80 text-sm mt-1">
                      Duration: {(restoreResult.duration_ms / 1000).toFixed(1)}s
                    </p>
                    {restoreResult.records_per_table && (
                      <div className="mt-3">
                        <h4 className="text-sm font-medium text-green-300 mb-2">Records by Table</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(restoreResult.records_per_table).map(([table, data]: [string, any]) => (
                            <span key={table} className="px-3 py-1 bg-green-900/50 rounded text-sm text-green-300">
                              {table}: {data.new + data.updated}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-red-300 font-medium">Restore failed</p>
                    <p className="text-red-400/80 text-sm mt-1">{restoreResult.error}</p>
                    <p className="text-red-400/80 text-sm mt-2">
                      Data has been rolled back to pre-restore state.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === 'done' && (
              <div className="flex justify-end mt-6">
                <button
                  onClick={handleReset}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium"
                >
                  New Restore
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-Components ───────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-gray-500 text-sm">{label}</p>
      <p className="text-white text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-900/50 text-green-300',
    failed: 'bg-red-900/50 text-red-300',
    pending: 'bg-amber-900/50 text-amber-300',
    running: 'bg-blue-900/50 text-blue-300',
    rolled_back: 'bg-purple-900/50 text-purple-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${colors[status] || 'bg-gray-800 text-gray-400'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
