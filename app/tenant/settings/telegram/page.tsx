'use client';
import { useState, useEffect } from 'react';
import { Send, Bell, BellOff, TestTube, Shield, Lock, KeyRound, LogIn, UserPlus, Eye, EyeOff, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface TelegramSettings {
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_enabled: boolean;
  telegram_notify_login: boolean;
  telegram_notify_signup: boolean;
  telegram_notify_password_change: boolean;
  telegram_notify_2fa_change: boolean;
  telegram_notify_security_alerts: boolean;
}

export default function TelegramSettingsPage() {
  const [settings, setSettings] = useState<TelegramSettings>({
    telegram_bot_token: '',
    telegram_chat_id: '',
    telegram_enabled: false,
    telegram_notify_login: true,
    telegram_notify_signup: true,
    telegram_notify_password_change: true,
    telegram_notify_2fa_change: true,
    telegram_notify_security_alerts: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    fetch('/api/user/telegram')
      .then(r => r.json())
      .then(d => {
        if (d.ok) setSettings(d.settings);
      })
      .catch(() => toast.error('Failed to load Telegram settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/telegram', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const d = await res.json();
      if (d.ok) {
        toast.success('Telegram settings saved');
      } else {
        toast.error(d.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save settings');
    }
    setSaving(false);
  };

  const testBot = async () => {
    if (!settings.telegram_bot_token || !settings.telegram_chat_id) {
      toast.error('Enter bot token and chat ID first');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/user/telegram', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          telegram_bot_token: settings.telegram_bot_token,
          telegram_chat_id: settings.telegram_chat_id,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        toast.success('Test message sent! Check Telegram');
      } else {
        toast.error(d.error || 'Test failed');
      }
    } catch {
      toast.error('Test failed');
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-40 bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Send className="w-5 h-5" /> Telegram Notifications
        </h1>
        <p className="text-sm text-muted-foreground">
          Get instant notifications on your phone via Telegram — login alerts, security events, and more.
        </p>
      </div>

      {/* Setup Guide */}
      <div className="admin-card p-5 border-l-4 border-violet-500">
        <h2 className="font-semibold mb-3">⚡ Setup Guide (2 minutes)</h2>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-bold text-foreground shrink-0">1.</span>
            <span>Open Telegram and search <code className="bg-muted px-1.5 py-0.5 rounded text-xs">@BotFather</code></span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-foreground shrink-0">2.</span>
            <span>Send <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/newbot</code> → follow instructions → copy the <strong>Bot Token</strong></span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-foreground shrink-0">3.</span>
            <span>Open Telegram, search <code className="bg-muted px-1.5 py-0.5 rounded text-xs">@userinfobot</code> → send <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/start</code> → copy the <strong>Chat ID</strong></span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-foreground shrink-0">4.</span>
            <span>Search for your new bot in Telegram, send <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/start</code> to activate it</span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-foreground shrink-0">5.</span>
            <span>Paste Bot Token and Chat ID below, click <strong>Test Connection</strong></span>
          </li>
        </ol>
      </div>

      {/* Bot Configuration */}
      <div className="admin-card p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Bot Configuration
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Bot Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={settings.telegram_bot_token}
                onChange={e => setSettings(s => ({ ...s, telegram_bot_token: e.target.value }))}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
              >
                {showToken ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Chat ID</label>
            <input
              type="text"
              value={settings.telegram_chat_id}
              onChange={e => setSettings(s => ({ ...s, telegram_chat_id: e.target.value }))}
              placeholder="123456789"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
            />
          </div>

          {/* Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
            <div className="flex items-center gap-3">
              {settings.telegram_enabled ? <Bell className="w-5 h-5 text-violet-500" /> : <BellOff className="w-5 h-5 text-muted-foreground" />}
              <div>
                <p className="font-medium text-sm">Enable Notifications</p>
                <p className="text-xs text-muted-foreground">Turn on to receive Telegram alerts</p>
              </div>
            </div>
            <button
              onClick={() => setSettings(s => ({ ...s, telegram_enabled: !s.telegram_enabled }))}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                settings.telegram_enabled ? 'bg-violet-600' : 'bg-muted'
              )}
            >
              <span className={cn(
                'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow',
                settings.telegram_enabled ? 'translate-x-5' : 'translate-x-0'
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* Notification Types */}
      <div className="admin-card p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4" /> Notification Types
        </h2>

        <div className="space-y-3">
          {[
            { key: 'telegram_notify_login' as const, icon: LogIn, label: 'Login Alerts', desc: 'Get notified when someone log into your account' },
            { key: 'telegram_notify_signup' as const, icon: UserPlus, label: 'New Signups', desc: 'Alert when a new user joins your workspace' },
            { key: 'telegram_notify_password_change' as const, icon: Lock, label: 'Password Changes', desc: 'Alert when password is changed' },
            { key: 'telegram_notify_2fa_change' as const, icon: KeyRound, label: '2FA Changes', desc: 'Alert when 2FA is enabled or disabled' },
            { key: 'telegram_notify_security_alerts' as const, icon: Shield, label: 'Security Alerts', desc: 'Critical security events and suspicious activity' },
          ].map(({ key, icon: Icon, label, desc }) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
              <button
                onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors',
                  settings[key] ? 'bg-violet-600' : 'bg-muted'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow',
                  settings[key] ? 'translate-x-5' : 'translate-x-0'
                )} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={testBot}
          disabled={testing}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors"
        >
          <TestTube className="w-4 h-4" />
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
