'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  Calendar,
  Shield,
  Trash2,
  RefreshCw,
  Play,
  CheckCircle,
  AlertTriangle,
  X,
  Search,
  RotateCcw,
  BarChart3,
  Settings,
  Loader2,
  Plus,
  Eye,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface BackupSchedule {
  id: string;
  tenant_id?: string;
  schedule_type: 'daily' | 'weekly' | 'monthly';
  backup_type: 'full' | 'critical_only';
  retention_days: number;
  enabled: boolean;
  last_run_at?: string;
  next_run_at?: string;
}

interface BackupRecord {
  id: string;
  tenant_id: string;
  tenant_name?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  backup_type: string;
  table_count: number;
  record_count: number;
  data_size: number;
  initiated_auto: boolean;
  retention_days: number;
  created_at: string;
  expires_at: string;
  completed_at?: string;
  error_message?: string;
}

interface CriticalBackup {
  id: string;
  tenant_id: string;
  table_name: string;
  record_id: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  backup_data: Record<string, any>;
  operation: 'insert' | 'update' | 'delete';
  backed_up_at: string;
  retained_until: string;
  deleted_by?: string;
  can_restore: boolean;
}

interface CriticalStats {
  total_backups: number;
  restorable: number;
  deleted_records: number;
  updated_records: number;
  by_table: { table_name: string; count: number }[];
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SuperAdminBackups() {
  const [activeTab, setActiveTab] = useState<'schedules' | 'history' | 'deleted'>('schedules');
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [deletedData, setDeletedData] = useState<CriticalBackup[]>([]);
  const [criticalStats, setCriticalStats] = useState<CriticalStats | null>(null);
  const [_loading, _setLoading] = useState(false);
  const [_showScheduleModal, setShowScheduleModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<CriticalBackup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [runningBackup, setRunningBackup] = useState(false);

  useEffect(() => {
    loadSchedules();
    loadBackups();
    loadCriticalData();
  }, []);

  const loadSchedules = async () => {
    try {
      const res = await fetch('/api/superadmin/backups');
      const data = await res.json();
      if (data.schedules) setSchedules(data.schedules);
    } catch (err) {
      console.error('Failed to load schedules:', err);
    }
  };

  const loadBackups = async () => {
    try {
      const res = await fetch('/api/superadmin/backups?list=recent');
      const data = await res.json();
      if (data.backups) setBackups(data.backups);
    } catch (err) {
      console.error('Failed to load backups:', err);
    }
  };

  const loadCriticalData = async () => {
    try {
      const res = await fetch('/api/superadmin/backups?critical=true');
      const data = await res.json();
      if (data.deleted) setDeletedData(data.deleted);
      if (data.stats) setCriticalStats(data.stats);
    } catch (err) {
      console.error('Failed to load critical data:', err);
    }
  };

  const runManualBackup = async () => {
    setRunningBackup(true);
    try {
      const res = await fetch('/api/superadmin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_type: 'full' }),
      });
      const data = await res.json();
      console.log('Manual backup result:', data);
      loadBackups();
    } catch (err) {
      console.error('Manual backup failed:', err);
    } finally {
      setRunningBackup(false);
    }
  };

  const toggleSchedule = async (scheduleId: string, enabled: boolean) => {
    try {
      await fetch('/api/superadmin/backups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, enabled }),
      });
      loadSchedules();
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    }
  };

  const restoreDeletedData = async (backupId: string) => {
    try {
      const res = await fetch('/api/superadmin/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', backupId }),
      });
      const data = await res.json();
      if (data.success) {
        setShowRestoreModal(false);
        setSelectedBackup(null);
        loadCriticalData();
      }
    } catch (err) {
      console.error('Restore failed:', err);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const timeAgo = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const daysUntilExpiry = (dateStr: string | null | undefined) => {
    if (!dateStr) return 999;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diff / 86400000);
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-7 h-7 text-green-400" />
            Backup & Data Protection
          </h1>
          <p className="text-gray-400 mt-1">Automated backups, 90-day retention, deleted data recovery</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={runManualBackup}
            disabled={runningBackup}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:opacity-50 rounded-lg text-white font-medium flex items-center gap-2"
          >
            {runningBackup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Backup Now
          </button>
        </div>
      </div>

      {/* Critical Data Stats */}
      {criticalStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Shield className="w-5 h-5" />} label="Total Backups" value={criticalStats.total_backups} color="blue" />
          <StatCard icon={<CheckCircle className="w-5 h-5" />} label="Restorable" value={criticalStats.restorable} color="green" />
          <StatCard icon={<Trash2 className="w-5 h-5" />} label="Deleted Records" value={criticalStats.deleted_records} color="amber" />
          <StatCard icon={<RefreshCw className="w-5 h-5" />} label="Updated Records" value={criticalStats.updated_records} color="purple" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit">
        {[
          { id: 'schedules' as const, label: 'Schedules', icon: <Calendar className="w-4 h-4" /> },
          { id: 'history' as const, label: 'Backup History', icon: <Clock className="w-4 h-4" /> },
          { id: 'deleted' as const, label: 'Deleted Data', icon: <Trash2 className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Schedules Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'schedules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Backup Schedules
            </h2>
            <button
              onClick={() => setShowScheduleModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add Schedule
            </button>
          </div>

          {schedules.length === 0 ? (
            <div className="text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
              <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No backup schedules configured</p>
              <p className="text-gray-500 text-sm mt-1">Default monthly backup will run automatically</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map(schedule => (
                <div key={schedule.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${schedule.enabled ? 'bg-green-900/50' : 'bg-gray-800'}`}>
                      <Calendar className={`w-5 h-5 ${schedule.enabled ? 'text-green-400' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <p className="text-white font-medium">
                        {schedule.tenant_id ? 'Per-Tenant Backup' : 'Global Backup (All Tenants)'}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                        <span className="capitalize">{schedule.schedule_type}</span>
                        <span>•</span>
                        <span className="capitalize">{schedule.backup_type.replace('_', ' ')}</span>
                        <span>•</span>
                        <span>{schedule.retention_days}-day retention</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm text-gray-400">
                      {schedule.next_run_at && (
                        <p>Next: {timeAgo(schedule.next_run_at)}</p>
                      )}
                      {schedule.last_run_at && (
                        <p>Last: {timeAgo(schedule.last_run_at)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => toggleSchedule(schedule.id, !schedule.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        schedule.enabled
                          ? 'bg-green-900/50 text-green-300 hover:bg-green-900/70'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {schedule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Retention Info */}
          <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-amber-300 font-medium">90-Day Data Retention Policy</h3>
              <p className="text-amber-400/80 text-sm mt-1">
                All deleted critical data is automatically backed up and retained for <strong>90 days minimum</strong>.
                Even if a user or admin deletes data, it can be fully restored within this window.
                Backups are automatically purged after the retention period expires.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Backup History Tab ────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Backups
            </h2>
            <button onClick={loadBackups} className="p-2 hover:bg-gray-800 rounded-lg">
              <RefreshCw className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {backups.length === 0 ? (
            <div className="text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
              <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No backups yet</p>
              <p className="text-gray-500 text-sm mt-1">Run a manual backup or wait for the scheduled run</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tables</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {backups.map(backup => (
                    <tr key={backup.id} className="hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <BackupStatusBadge status={backup.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {backup.initiated_auto ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Auto
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Play className="w-3 h-3" /> Manual
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{backup.table_count}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{backup.record_count?.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{formatSize(backup.data_size || 0)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(backup.created_at)}</td>
                      <td className="px-4 py-3 text-xs">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                        {(backup as any).expires_at ? (
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                          <span className={daysUntilExpiry((backup as any).expires_at) < 7 ? 'text-red-400' : 'text-gray-500'}>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                            {daysUntilExpiry((backup as any).expires_at)}d left
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Deleted Data Tab ──────────────────────────────────────────────── */}
      {activeTab === 'deleted' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Deleted Data Recovery
            </h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search deleted records…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button onClick={loadCriticalData} className="p-2 hover:bg-gray-800 rounded-lg">
                <RefreshCw className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          </div>

          {/* By Table Breakdown */}
          {criticalStats?.by_table && criticalStats.by_table.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Deleted Records by Table
              </h3>
              <div className="flex flex-wrap gap-2">
                {criticalStats.by_table.map(item => (
                  <span key={item.table_name} className="px-3 py-1.5 bg-gray-800 rounded-lg text-sm text-gray-300 flex items-center gap-2">
                    {item.table_name}
                    <span className="text-white font-medium">{item.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Deleted Records List */}
          {deletedData.length === 0 ? (
            <div className="text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <p className="text-gray-400">No deleted data in backup</p>
              <p className="text-gray-500 text-sm mt-1">All critical data is intact</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Table</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Record ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Operation</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deleted</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retained Until</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {deletedData
                    .filter(d =>
                      !searchQuery ||
                      d.table_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      d.record_id.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map(backup => (
                      <tr key={backup.id} className="hover:bg-gray-800/30">
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs font-mono">
                            {backup.table_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono">{backup.record_id.slice(0, 8)}…</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            backup.operation === 'delete' ? 'bg-red-900/50 text-red-300' :
                            backup.operation === 'update' ? 'bg-amber-900/50 text-amber-300' :
                            'bg-green-900/50 text-green-300'
                          }`}>
                            {backup.operation}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(backup.backed_up_at)}</td>
                        <td className="px-4 py-3 text-xs">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                          {daysUntilExpiry((backup as any).retained_until) > 0 ? (
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                            <span className={daysUntilExpiry((backup as any).retained_until) < 7 ? 'text-red-400' : 'text-gray-500'}>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                              {daysUntilExpiry((backup as any).retained_until)} days
                            </span>
                          ) : (
                            <span className="text-red-400">Expired</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setSelectedBackup(backup); setShowRestoreModal(true); }}
                              disabled={!backup.can_restore}
                              className="p-1.5 hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Preview & Restore"
                            >
                              <RotateCcw className="w-4 h-4 text-green-400" />
                            </button>
                            <button
                              onClick={() => { setSelectedBackup(backup); }}
                              className="p-1.5 hover:bg-gray-700 rounded"
                              title="View Data"
                            >
                              <Eye className="w-4 h-4 text-blue-400" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Restore Modal ─────────────────────────────────────────────────── */}
      {showRestoreModal && selectedBackup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-green-400" />
                Restore Deleted Record
              </h3>
              <button onClick={() => { setShowRestoreModal(false); setSelectedBackup(null); }} className="p-1 hover:bg-gray-800 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Record Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoField label="Table" value={selectedBackup.table_name} />
              <InfoField label="Record ID" value={selectedBackup.record_id} />
              <InfoField label="Deleted At" value={new Date(selectedBackup.backed_up_at).toLocaleString()} />
              <InfoField label="Retained Until" value={new Date(selectedBackup.retained_until).toLocaleString()} />
              <InfoField label="Operation" value={selectedBackup.operation} />
              <InfoField label="Days Remaining" value={String(daysUntilExpiry(selectedBackup.retained_until))} />
            </div>

            {/* Data Preview */}
            <div>
              <label className="text-xs text-gray-500 uppercase mb-2 block">Saved Data Snapshot</label>
              <pre className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-xs text-gray-300 overflow-auto max-h-60">
                {JSON.stringify(selectedBackup.backup_data, null, 2)}
              </pre>
            </div>

            <div className="bg-amber-900/20 border border-amber-800/50 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-amber-300 text-sm">
                This will re-insert the record into the <strong>{selectedBackup.table_name}</strong> table.
                If a record with this ID already exists, it will be skipped.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRestoreModal(false); setSelectedBackup(null); }}
                className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => restoreDeletedData(selectedBackup.id)}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg text-white font-medium flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Restore This Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-800',
    green: 'from-green-500/20 to-green-600/5 border-green-800',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-800',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-800',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color] || colorMap['blue']} border rounded-lg p-4`}>
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function BackupStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    completed: { bg: 'bg-green-900/50', text: 'text-green-300', label: 'Completed' },
    running: { bg: 'bg-blue-900/50', text: 'text-blue-300', label: 'Running' },
    failed: { bg: 'bg-red-900/50', text: 'text-red-300', label: 'Failed' },
    pending: { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Pending' },
  };
  const c = config[status] || { bg: 'bg-gray-800', text: 'text-gray-400', label: 'Pending' };
  return (
    <span className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 ${c.bg} ${c.text}`}>
      {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === 'completed' && <CheckCircle className="w-3 h-3" />}
      {status === 'failed' && <AlertTriangle className="w-3 h-3" />}
      {c.label}
    </span>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-xs text-gray-500 uppercase">{label}</label>
      <p className="text-sm text-white bg-gray-800 px-3 py-1.5 rounded mt-1 font-mono">{value}</p>
    </div>
  );
}
