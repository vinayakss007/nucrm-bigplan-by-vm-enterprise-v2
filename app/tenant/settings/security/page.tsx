'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Shield, Lock, Key, Download, RefreshCw, Trash2, Eye, EyeOff, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { sanitizeHTML } from '@/lib/sanitize';

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // 2FA states
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrCode, setTotpQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  
  // Password states
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [savingPassword, setSavingPassword] = useState(false);
  
  // Disable 2FA states
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  
  // Trash retention states
  const [retentionDays, setRetentionDays] = useState(30);
  const [pendingDeletion, setPendingDeletion] = useState<any>(null);
  const [loadingRetention, setLoadingRetention] = useState(true);
  const [savingRetention, setSavingRetention] = useState(false);

  // IP whitelist states
  const [ipWhitelist, setIpWhitelist] = useState<string[]>([]);
  const [ipEnabled, setIpEnabled] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [loadingIp, setLoadingIp] = useState(true);
  const [savingIp, setSavingIp] = useState(false);

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const res = await fetch('/api/tenant/me');
      const data = await res.json();
      setUser(data.user);
      setTotpEnabled(data.user?.totp_enabled ?? false);
    } catch (err) {
      toast.error('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  const loadTrashRetention = async () => {
    try {
      const [settingsRes, cleanupRes] = await Promise.all([
        fetch('/api/tenant/trash/settings'),
        fetch('/api/tenant/trash/auto-cleanup')
      ]);
      const settingsData = await settingsRes.json();
      const cleanupData = await cleanupRes.json();
      setRetentionDays(settingsData.data?.retention_days || 30);
      setPendingDeletion(cleanupData.data);
    } catch (err) {
      console.error('Failed to load trash settings', err);
    } finally {
      setLoadingRetention(false);
    }
  };

  const saveTrashRetention = async (days: number) => {
    setSavingRetention(true);
    try {
      const res = await fetch('/api/tenant/trash/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_days: days })
      });
      if (!res.ok) throw new Error('Failed to save');
      setRetentionDays(days);
      toast.success('Trash retention updated');
    } catch (err) {
      toast.error('Failed to save retention settings');
    } finally {
      setSavingRetention(false);
    }
  };

  const loadIpWhitelist = async () => {
    try {
      const res = await fetch('/api/tenant/security/ip-whitelist');
      const data = await res.json();
      setIpWhitelist(data.data?.ips || []);
      setIpEnabled(data.data?.enabled || false);
    } catch (err) {
      console.error('Failed to load IP whitelist', err);
    } finally {
      setLoadingIp(false);
    }
  };

  const saveIpWhitelist = async (ips: string[], enabled: boolean) => {
    setSavingIp(true);
    try {
      const res = await fetch('/api/tenant/security/ip-whitelist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips, enabled })
      });
      if (!res.ok) throw new Error('Failed to save');
      setIpWhitelist(ips);
      setIpEnabled(enabled);
      toast.success('IP whitelist updated');
    } catch (err) {
      toast.error('Failed to save IP whitelist');
    } finally {
      setSavingIp(false);
    }
  };

  const addIp = () => {
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    if (!ipRegex.test(newIp)) {
      toast.error('Invalid IP address format');
      return;
    }
    if (ipWhitelist.includes(newIp)) {
      toast.error('IP already in whitelist');
      return;
    }
    saveIpWhitelist([...ipWhitelist, newIp], true);
    setNewIp('');
  };

  const removeIp = (ip: string) => {
    const newList = ipWhitelist.filter(i => i !== ip);
    saveIpWhitelist(newList, newList.length > 0);
  };

  useEffect(() => {
    loadTrashRetention();
    loadIpWhitelist();
  }, []);

  // ── Enable 2FA ──────────────────────────────────────────────
  const startTotpSetup = async () => {
    const res = await fetch('/api/tenant/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setTotpSecret(data.secret);
    setTotpQrCode(data.qr_code);
    setBackupCodes(data.backup_codes || []);
    setShowTotpSetup(true);
  };

  const verifyTotpSetup = async () => {
    if (!totpCode || totpCode.length !== 6) {
      toast.error('Enter a valid 6-digit code');
      return;
    }
    const res = await fetch('/api/tenant/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totp_code: totpCode, backup_codes: backupCodes }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setTotpEnabled(true);
    setShowTotpSetup(false);
    toast.success('2FA enabled successfully!');
  };

  // ── Disable 2FA ──────────────────────────────────────────────
  const disableTotp = async () => {
    if (!disablePassword) {
      toast.error('Enter your password');
      return;
    }
    if (totpEnabled && (!disableCode || disableCode.length !== 6)) {
      toast.error('Enter current 2FA code');
      return;
    }
    setDisabling(true);
    const res = await fetch('/api/tenant/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        password: disablePassword,
        totp_code: totpEnabled ? disableCode : undefined
      }),
    });
    const data = await res.json();
    setDisabling(false);
    if (!res.ok) { toast.error(data.error); return; }
    setTotpEnabled(false);
    setShowDisable2FA(false);
    setDisablePassword('');
    setDisableCode('');
    toast.success('2FA disabled');
  };

  // ── Change Password ──────────────────────────────────────────
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (passwords.new.length < 12) {
      toast.error('Password must be at least 12 characters with uppercase, number, and special character');
      return;
    }
    if (!/[A-Z]/.test(passwords.new)) {
      toast.error('Password must contain an uppercase letter');
      return;
    }
    if (!/[0-9]/.test(passwords.new)) {
      toast.error('Password must contain a number');
      return;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(passwords.new)) {
      toast.error('Password must contain a special character');
      return;
    }
    setSavingPassword(true);
    const res = await fetch('/api/user/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: passwords.current,
        new_password: passwords.new,
      }),
    });
    const data = await res.json();
    setSavingPassword(false);
    if (!res.ok) { toast.error(data.error); return; }
    setPasswords({ current: '', new: '', confirm: '' });
    setShowPasswordForm(false);
    toast.success('Password changed successfully');
  };

  // ── Regenerate Backup Codes ──────────────────────────────────
  const regenerateBackupCodes = async () => {
    const res = await fetch('/api/tenant/2fa/backup-codes', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setBackupCodes(data.backup_codes);
    toast.success('Backup codes regenerated. Old codes are now invalid.');
  };

  const downloadBackupCodes = () => {
    const content = `NuCRM Backup Codes\n==================\nGenerated: ${new Date().toLocaleString()}\n\nSave these codes in a safe place. Each code can only be used once.\n\n${backupCodes.join('\n')}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nucrm-backup-codes-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-40 bg-muted rounded" />
        <div className="admin-card h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-violet-600" />
        <h1 className="text-lg font-bold">Security Settings</h1>
      </div>

      {/* ── Two-Factor Authentication ─────────────────────────── */}
      <div className="admin-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', totpEnabled ? 'bg-emerald-100 dark:bg-emerald-950/30' : 'bg-muted')}>
              <Shield className={cn('w-5 h-5', totpEnabled ? 'text-emerald-600' : 'text-muted-foreground')} />
            </div>
            <div>
              <p className="font-semibold">Two-Factor Authentication</p>
              <p className="text-xs text-muted-foreground">
                {totpEnabled ? '2FA is enabled' : 'Add an extra layer of security'}
              </p>
            </div>
          </div>
          {totpEnabled ? (
            <button onClick={() => setShowDisable2FA(true)} className="text-sm text-red-600 hover:underline font-medium">
              Disable
            </button>
          ) : (
            <button onClick={startTotpSetup} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
              Enable 2FA
            </button>
          )}
        </div>

        {totpEnabled && (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 space-y-2">
            <p className="text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Your account is protected with 2FA
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBackupCodes([])} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1">
                <Download className="w-3 h-3" /> View Backup Codes
              </button>
              <button onClick={regenerateBackupCodes} className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Regenerate Codes
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Change Password ───────────────────────────────────── */}
      <div className="admin-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">Password</p>
              <p className="text-xs text-muted-foreground">Change your login password</p>
            </div>
          </div>
          <button onClick={() => setShowPasswordForm(!showPasswordForm)} className="text-sm text-violet-600 hover:underline font-medium">
            {showPasswordForm ? 'Cancel' : 'Change'}
          </button>
        </div>

        {showPasswordForm && (
          <form onSubmit={changePassword} className="space-y-3 pt-3 border-t border-border">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Current Password</label>
              <div className="relative">
                <input type={showPasswords.current ? 'text' : 'password'} value={passwords.current} onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} className={inp} />
                <button type="button" onClick={() => setShowPasswords(p => ({ ...p, current: !p.current }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">New Password</label>
              <div className="relative">
                <input type={showPasswords.new ? 'text' : 'password'} value={passwords.new} onChange={e => setPasswords(p => ({ ...p, new: e.target.value }))} className={inp} />
                <button type="button" onClick={() => setShowPasswords(p => ({ ...p, new: !p.new }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Confirm New Password</label>
              <div className="relative">
                <input type={showPasswords.confirm ? 'text' : 'password'} value={passwords.confirm} onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} className={inp} />
                <button type="button" onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={savingPassword} className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
              {savingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        )}
      </div>

      {/* ── Backup Codes Display ──────────────────────────────── */}
      {backupCodes.length > 0 && (
        <div className="admin-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold">Backup Codes</h3>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Save these codes now! They won't be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {backupCodes.map((code, i) => (
                <div key={i} className="bg-white dark:bg-slate-900 px-3 py-2 rounded font-mono text-sm text-center border border-border">
                  {code}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadBackupCodes} className="flex-1 py-2 rounded-lg border border-border hover:bg-accent text-sm font-medium flex items-center justify-center gap-2">
                <Download className="w-4 h-4" /> Download
              </button>
              <button onClick={() => setBackupCodes([])} className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
                I've Saved These
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disable 2FA Modal ─────────────────────────────────── */}
      {showDisable2FA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDisable2FA(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-600" />
                Disable 2FA
              </h3>
              <button onClick={() => setShowDisable2FA(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to disable 2FA? Your account will be less secure.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Your Password</label>
                <input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} className={inp} />
              </div>
              {totpEnabled && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Current 2FA Code</label>
                  <input type="text" maxLength={6} value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))} className={inp} placeholder="123456" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowDisable2FA(false)} className="flex-1 py-2 rounded-lg border border-border hover:bg-accent text-sm font-medium">
                  Cancel
                </button>
                <button onClick={disableTotp} disabled={disabling} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                  {disabling && <Loader2 className="w-4 h-4 animate-spin" />}
                  {disabling ? 'Disabling...' : 'Disable 2FA'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 2FA Setup Modal ───────────────────────────────────── */}
      {showTotpSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTotpSetup(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="w-5 h-5 text-violet-600" />
                Enable 2FA
              </h3>
              <button onClick={() => setShowTotpSetup(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">Scan this QR code with Google Authenticator or Authy</p>
              {totpQrCode && (
                <div className="bg-white p-3 rounded-lg inline-block">
                  {/* SECURITY: QR code is server-generated SVG from qrcode library. 
                      Using DOMPurify-sanitized HTML to prevent any XSS. */}
                  {(() => {
                    try {
                      // Extract the img src if it's an img tag
                      const imgMatch = totpQrCode.match(/<img[^>]+src="([^"]+)"/);
                      if (imgMatch?.[1]) {
                        return <Image src={imgMatch[1]} alt="QR Code for 2FA setup" className="w-48 h-48" />;
                      }
                      // If it's an SVG, render it directly (sanitized by checking it starts with <svg)
                      if (totpQrCode.startsWith('<svg')) {
                        return <div dangerouslySetInnerHTML={{ __html: sanitizeHTML(totpQrCode) }} />;
                      }
                      return null;
                    } catch {
                      return null;
                    }
                  })()}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Enter 6-digit code from app</label>
              <input type="text" maxLength={6} value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))} className={inp} placeholder="123456" />
            </div>

            <button onClick={verifyTotpSetup} className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
              Verify & Enable
            </button>
          </div>
        </div>
      )}

      {/* Trash Retention Section */}
      <div className="border-t pt-8 mt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-amber-100">
            <Trash2 className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold">Trash Retention</h3>
            <p className="text-sm text-muted-foreground">Configure how long deleted items stay in trash before permanent deletion</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-sm font-medium">Retention Period</p>
              <p className="text-xs text-muted-foreground">Items in trash will be permanently deleted after this period</p>
            </div>
            <select
              value={retentionDays}
              onChange={(e) => saveTrashRetention(parseInt(e.target.value))}
              disabled={savingRetention}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm min-w-[150px]"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </select>
          </div>

          {pendingDeletion && pendingDeletion.total > 0 && (
            <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
              <div className="flex items-center gap-2 text-orange-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">{pendingDeletion.total} items pending permanent deletion</span>
              </div>
              <p className="text-xs text-orange-600 mt-1">
                These items will be deleted on {new Date(pendingDeletion.cutoff_date).toLocaleDateString()}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={async () => {
                const res = await fetch('/api/tenant/trash/auto-cleanup', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                  toast.success(`Cleaned up ${data.cleaned_up.contacts + data.cleaned_up.companies + data.cleaned_up.deals + data.cleaned_up.tasks + data.cleaned_up.leads} items`);
                  loadTrashRetention();
                } else {
                  toast.error(data.error);
                }
              }}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted"
            >
              Run Cleanup Now
            </button>
          </div>
        </div>
      </div>

      {/* IP Whitelist Section */}
      <div className="border-t pt-8 mt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-blue-100">
            <Lock className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold">IP Whitelist</h3>
            <p className="text-sm text-muted-foreground">Restrict access to specific IP addresses or CIDR ranges</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-sm font-medium">IP Restriction</p>
              <p className="text-xs text-muted-foreground">Only allow access from whitelisted IPs</p>
            </div>
            <button
              onClick={() => saveIpWhitelist(ipWhitelist, !ipEnabled)}
              disabled={savingIp || ipWhitelist.length === 0}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                ipEnabled ? "bg-violet-600" : "bg-muted"
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                ipEnabled ? "translate-x-6" : "translate-x-1"
              )} />
            </button>
          </div>

          {ipEnabled && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">IP restriction is enabled</span>
              </div>
              <p className="text-xs text-amber-600 mt-1">
                Your current IP may be blocked if not in the whitelist
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              placeholder="192.168.1.1 or 10.0.0.0/24"
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            <button
              onClick={addIp}
              disabled={!newIp || savingIp}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-50"
            >
              Add IP
            </button>
          </div>

          {ipWhitelist.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Whitelisted IPs:</p>
              {ipWhitelist.map((ip) => (
                <div key={ip} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                  <code className="text-sm font-mono">{ip}</code>
                  <button
                    onClick={() => removeIp(ip)}
                    className="text-red-500 hover:text-red-600 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {ipWhitelist.length === 0 && (
            <p className="text-sm text-muted-foreground">No IPs added yet. Add at least one IP to enable restriction.</p>
          )}
        </div>
      </div>
    </div>
  );
}
