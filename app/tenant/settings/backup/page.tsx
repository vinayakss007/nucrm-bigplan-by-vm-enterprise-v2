'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  HardDrive, Database, Play, CheckCircle, XCircle, Clock, RefreshCw,
  Save, Loader2, Eye, EyeOff, AlertTriangle, Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// ── Types ──────────────────────────────────────────────────────
interface BackupConfig {
  id?: string;
  tenant_id: string;
  endpoint_url: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  region: string;
  backup_type: 'full' | 'schema';
  enabled: boolean;
  schedule: string;
  retention_days: number;
  point_in_time_recovery: boolean;
  created_at?: string;
  updated_at?: string;
}

interface BackupRecord {
  id: string;
  backup_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  size_bytes: number | null;
  storage_path: string | null;
  storage_type: string;
  duration_ms: number | null;
  error_message: string | null;
  initiated_auto: boolean;
  created_at: string;
  completed_at: string | null;
}

// ── Helpers ────────────────────────────────────────────────────
function formatBytes(b: number | null): string {
  if (!b || b === 0) return '—';
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STATUS_MAP: Record<string, { icon: any; color: string; bg: string }> = {
  completed: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-500/10' },
  running: { icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-500/10' },
  pending: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' },
};

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

// ── Page ───────────────────────────────────────────────────────
export default function TenantBackupSettingsPage() {
  const [config, setConfig] = useState<BackupConfig>({
    tenant_id: '',
    endpoint_url: '',
    bucket: '',
    access_key: '',
    secret_key: '',
    region: 'us-east-1',
    backup_type: 'full',
    enabled: true,
    schedule: '0 2 * * *',
    retention_days: 30,
    point_in_time_recovery: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showAccessKey, setShowAccessKey] = useState(false);

  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [runningBackup, setRunningBackup] = useState(false);
  const [bkType, setBkType] = useState<'full' | 'schema'>('full');

  // Load config
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/backup/config');
      if (res.ok) {
        const d = await res.json();
        if (d.data) {
          setConfig({
            tenant_id: d.data.tenant_id || '',
            endpoint_url: d.data.endpoint_url || '',
            bucket: d.data.bucket || '',
            access_key: d.data.access_key || '',
            secret_key: '', // never returned on read
            region: d.data.region || 'us-east-1',
            backup_type: d.data.backup_type || 'full',
            enabled: d.data.enabled ?? true,
            schedule: d.data.schedule || '0 2 * * *',
            retention_days: d.data.retention_days || 30,
            point_in_time_recovery: d.data.point_in_time_recovery ?? false,
          });
          setBkType(d.data.backup_type || 'full');
        }
      }
    } catch (err) {
      console.error('[backup] failed to load config', err);
    }
    setLoaded(true);
  }, []);

  // Load backup history
  const loadBackups = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/backup');
      if (res.ok) {
        const d = await res.json();
        setBackups(d.backups || []);
      }
    } catch (err) {
      console.error('[backup] failed to load backups', err);
    }
    setLoadingBackups(false);
  }, []);

  useEffect(() => { loadConfig(); loadBackups(); }, [loadConfig, loadBackups]);

  // Save config
  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.bucket.trim()) {
      toast.error('Bucket name is required');
      return;
    }
    if (!config.access_key.trim() && !config.secret_key.trim()) {
      // If both empty, check if we already have stored keys
      if (!config.endpoint_url) {
        toast.error('Endpoint URL is required');
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/backup/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint_url: config.endpoint_url.trim(),
          bucket: config.bucket.trim(),
          access_key: config.access_key.trim(),
          secret_key: config.secret_key.trim() || undefined, // omit if not changed
          region: config.region.trim(),
          backup_type: config.backup_type,
          enabled: config.enabled,
          schedule: config.schedule,
          retention_days: config.retention_days,
          point_in_time_recovery: config.point_in_time_recovery,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Backup configuration saved');
        setConfig(prev => ({ ...prev, secret_key: '' })); // clear after save
        loadConfig();
      } else {
        toast.error(d.error || 'Failed to save');
      }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (_err: any) {
      toast.error('Network error');
    }
    setSaving(false);
  };

  // Trigger manual backup
  const triggerBackup = async () => {
    setRunningBackup(true);
    try {
      const res = await fetch('/api/tenant/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup_type: bkType }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Backup started');
        loadBackups();
      } else {
        toast.error(d.error || 'Backup failed');
      }
    } catch {
      toast.error('Network error');
    }
    setRunningBackup(false);
  };

  const hasConfig = !!(config.endpoint_url || config.bucket || config.access_key);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-violet-600" />
          Backup Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure object storage and manage database backups for your workspace
        </p>
      </div>

      {/* Object Storage Configuration */}
      <form onSubmit={saveConfig} className="space-y-5">
        <div className="admin-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Object Storage
          </div>
          <p className="text-xs text-muted-foreground">
            Connect your S3-compatible storage (AWS S3, Cloudflare R2, MinIO, etc.) to store backups
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Endpoint URL
              </label>
              <input
                value={config.endpoint_url}
                onChange={e => setConfig(f => ({ ...f, endpoint_url: e.target.value }))}
                className={inp}
                placeholder="https://<account-id>.r2.cloudflarestorage.com (leave blank for AWS S3)"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Leave empty for standard AWS S3. Set for R2, MinIO, or compatible services.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Bucket Name
                </label>
                <input
                  value={config.bucket}
                  onChange={e => setConfig(f => ({ ...f, bucket: e.target.value }))}
                  className={inp}
                  placeholder="my-nucrm-backups"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Region
                </label>
                <input
                  value={config.region}
                  onChange={e => setConfig(f => ({ ...f, region: e.target.value }))}
                  className={inp}
                  placeholder="us-east-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Access Key ID
                </label>
                <div className="relative">
                  <input
                    type={showAccessKey ? 'text' : 'password'}
                    value={config.access_key}
                    onChange={e => setConfig(f => ({ ...f, access_key: e.target.value }))}
                    className={cn(inp, 'pr-8')}
                    placeholder="AKIA..."
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessKey(!showAccessKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showAccessKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Secret Access Key
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={config.secret_key}
                    onChange={e => setConfig(f => ({ ...f, secret_key: e.target.value }))}
                    className={cn(inp, 'pr-8')}
                    placeholder={hasConfig && !config.secret_key ? '•••••••• (unchanged)' : 'Enter secret key'}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Default backup type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Default Backup Type
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(['full', 'schema'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setConfig(f => ({ ...f, backup_type: t })); setBkType(t); }}
                  className={cn(
                    'flex-1 px-4 py-2 text-xs font-medium capitalize transition-colors',
                    config.backup_type === t
                      ? 'bg-violet-600 text-white'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t === 'full' ? 'Full (data + schema)' : 'Schema only'}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Backup Schedule (Cron)
            </label>
            <select
              value={config.schedule}
              onChange={e => setConfig(f => ({ ...f, schedule: e.target.value }))}
              className={inp}
            >
              <option value="0 2 * * *">Daily at 2:00 AM</option>
              <option value="0 2 * * 0">Weekly (Sunday at 2AM)</option>
              <option value="0 2 1 * *">Monthly (1st at 2AM)</option>
              <option value="0 */6 * * *">Every 6 hours</option>
              <option value="0 */12 * * *">Every 12 hours</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Current: {config.schedule}</p>
          </div>

          {/* Retention days */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Retention Period
            </label>
            <select
              value={config.retention_days}
              onChange={e => setConfig(f => ({ ...f, retention_days: parseInt(e.target.value) }))}
              className={inp}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Auto-delete backups older than {config.retention_days} days</p>
          </div>

          {/* Point in time recovery */}
          <div className="flex items-center justify-between py-2 border-t border-border">
            <div>
              <p className="text-sm font-medium">Point-in-Time Recovery</p>
              <p className="text-xs text-muted-foreground">Enable PITR for granular restore options</p>
            </div>
            <button
              type="button"
              onClick={() => setConfig(f => ({ ...f, point_in_time_recovery: !f.point_in_time_recovery }))}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                config.point_in_time_recovery ? 'bg-violet-600' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  config.point_in_time_recovery ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>

          {/* Enable/disable */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div>
              <p className="text-sm font-medium">Enable automated backups</p>
              <p className="text-xs text-muted-foreground">Run daily backups using this configuration</p>
            </div>
            <button
              type="button"
              onClick={() => setConfig(f => ({ ...f, enabled: !f.enabled }))}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                config.enabled ? 'bg-violet-600' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </form>

      {/* Manual Backup */}
      <div className="admin-card p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database className="w-4 h-4 text-muted-foreground" />
          Manual Backup
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['full', 'schema'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setBkType(t)}
                className={cn(
                  'px-4 py-2 text-xs font-medium capitalize transition-colors',
                  bkType === t ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t} backup
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex-1">
            {bkType === 'full'
              ? 'All data + schema (pg_dump custom format, compressed)'
              : 'Schema only — structure without data'}
          </p>
          <button
            onClick={triggerBackup}
            disabled={runningBackup}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            {runningBackup ? 'Starting...' : 'Run Backup Now'}
          </button>
        </div>
      </div>

      {/* Backup History */}
      <div className="admin-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold">Backup History</p>
          <button
            onClick={loadBackups}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {loadingBackups ? (
          <p className="text-xs text-muted-foreground text-center p-6">Loading...</p>
        ) : !backups.length ? (
          <div className="text-center py-10">
            <Database className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No backups yet — run your first backup above</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {backups.map(b => {
              const s = STATUS_MAP[b.status] ?? { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' };
              const SIcon = s.icon;
              return (
                <div key={b.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.bg)}>
                    <SIcon className={cn('w-4 h-4', s.color, b.status === 'running' && 'animate-spin')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium capitalize">{b.backup_type} Backup</p>
                      {b.initiated_auto && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                          auto
                        </span>
                      )}
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize', s.bg, s.color)}>
                        {b.status}
                      </span>
                    </div>
                    {b.error_message && (
                      <p className="text-[10px] text-red-600 mt-0.5 truncate">{b.error_message}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-foreground/70">{formatBytes(b.size_bytes)}</p>
                    {b.duration_ms && (
                      <p className="text-[10px] text-muted-foreground">{(b.duration_ms / 1000).toFixed(1)}s</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">{formatRelativeTime(b.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Setup guide */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-2">
        <p className="text-sm font-semibold text-amber-600 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Setup Guide
        </p>
        <div className="text-xs text-muted-foreground space-y-1.5">
          <p>
            <strong className="text-foreground">Cloudflare R2 (recommended, free tier):</strong> Create a bucket in R2, generate API tokens, and set the endpoint URL to{' '}
            <code className="bg-muted px-1 rounded font-mono text-xs">https://&lt;account-id&gt;.r2.cloudflarestorage.com</code>
          </p>
          <p>
            <strong className="text-foreground">AWS S3:</strong> Leave endpoint URL blank. Use standard S3 region and credentials.
          </p>
          <p>
            <strong className="text-foreground">MinIO:</strong> Set endpoint URL to your MinIO server URL (e.g., <code className="bg-muted px-1 rounded font-mono text-xs">http://minio:9000</code>).
          </p>
        </div>
      </div>
    </div>
  );
}
