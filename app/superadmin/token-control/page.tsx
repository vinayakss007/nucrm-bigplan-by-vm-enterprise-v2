'use client';

import { useState, useEffect } from 'react';
import {
  Coins,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  X,
  Plus,
  RotateCw,
  Key,
  Settings,
  Users,
  BarChart3,
  Download,
  Eye,
  Shield,
  Zap,
  Loader2,
} from 'lucide-react';

export default function SuperAdminTokenControl() {
  const [activeTab, setActiveTab] = useState<'budgets' | 'tenants' | 'keys' | 'alerts'>('budgets');
  const [budgets, setBudgets] = useState<any[]>([]);
  const [topTenants, setTopTenants] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [bRes, tRes, aRes, kRes] = await Promise.all([
        fetch('/api/superadmin/token-control/budgets'),
        fetch('/api/superadmin/token-control/report/top-spenders'),
        fetch('/api/superadmin/token-control/alerts?limit=20'),
        fetch('/api/superadmin/token-control/keys'),
      ]);
      const [b, t, a, k] = await Promise.all([bRes.json(), tRes.json(), aRes.json(), kRes.json()]);
      if (b.budgets) setBudgets(b.budgets);
      if (t.tenants) setTopTenants(t.tenants);
      if (a.alerts) setAlerts(a.alerts);
      if (k.keys) setApiKeys(k.keys);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const formatCurrency = (cents: number) => {
    const rupees = cents / 100;
    return `₹${rupees.toLocaleString('en-IN')}`;
  };

  const totalSpent = budgets.reduce((sum, b) => sum + (b.current_month_cents || 0), 0);
  const totalBudget = budgets.reduce((sum, b) => sum + (b.monthly_budget_cents || 0), 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Coins className="w-7 h-7 text-yellow-400" />
            Token & Usage Control
          </h1>
          <p className="text-gray-400 mt-1">Manage AI budgets, API keys, and per-tenant limits</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={loadAll} className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2">
            <RotateCw className="w-4 h-4" /> Refresh
          </button>
          <button className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2">
            <Download className="w-4 h-4" /> Export Report
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Coins className="w-5 h-5" />}
          label="Total Spent"
          value={formatCurrency(totalSpent)}
          subtext={`of ${formatCurrency(totalBudget)} budget`}
          color={totalSpent / totalBudget > 0.8 ? 'red' : 'blue'}
        />
        <SummaryCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="OpenAI"
          value={formatCurrency(budgets.find(b => b.service === 'openai')?.current_month_cents || 0)}
          subtext={`${budgets.find(b => b.service === 'openai')?.monthly_budget_cents ? formatCurrency(budgets.find(b => b.service === 'openai')?.monthly_budget_cents || 0) : 'No budget'}`}
          color="purple"
        />
        <SummaryCard
          icon={<Zap className="w-5 h-5" />}
          label="WhatsApp"
          value={formatCurrency(budgets.find(b => b.service === 'whatsapp')?.current_month_cents || 0)}
          subtext={`of ${formatCurrency(budgets.find(b => b.service === 'whatsapp')?.monthly_budget_cents || 0)}`}
          color="green"
        />
        <SummaryCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Active Alerts"
          value={String(alerts.filter(a => !a.acknowledged).length)}
          subtext={`${alerts.length} total`}
          color="amber"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg w-fit">
        {[
          { id: 'budgets' as const, label: 'Budgets', icon: <Coins className="w-4 h-4" /> },
          { id: 'tenants' as const, label: 'Top Spenders', icon: <TrendingUp className="w-4 h-4" /> },
          { id: 'keys' as const, label: 'API Keys', icon: <Key className="w-4 h-4" /> },
          { id: 'alerts' as const, label: 'Alerts', icon: <AlertTriangle className="w-4 h-4" /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
              activeTab === tab.id ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
        </div>
      )}

      {/* ── Budgets Tab ─────────────────────────────────────────────────── */}
      {!loading && activeTab === 'budgets' && (
        <div className="space-y-4">
          {budgets.map(budget => {
            const pct = budget.monthly_budget_cents > 0
              ? Math.min(100, (budget.current_month_cents / budget.monthly_budget_cents) * 100)
              : 0;
            const isWarning = pct >= 80;
            const isDanger = pct >= 100;

            return (
              <div key={budget.id} className={`bg-gray-900 border rounded-xl p-5 ${
                isDanger ? 'border-red-800' : isWarning ? 'border-amber-800' : 'border-gray-800'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      isDanger ? 'bg-red-900/50' : isWarning ? 'bg-amber-900/50' : 'bg-gray-800'
                    }`}>
                      <Coins className={`w-5 h-5 ${isDanger ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <h3 className="text-white font-medium capitalize">{budget.service}</h3>
                      <p className="text-sm text-gray-400">
                        {budget.hard_cap_enabled ? 'Hard cap ON' : 'Hard cap OFF'} · 
                        Alerts at {budget.alert_at_50pct ? '50%' : ''} {budget.alert_at_80pct ? '80%' : ''} {budget.alert_at_100pct ? '100%' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">{formatCurrency(budget.current_month_cents)}</p>
                    <p className="text-xs text-gray-500">of {formatCurrency(budget.monthly_budget_cents)}</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-800 rounded-full h-3 mb-2">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      isDanger ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className={isDanger ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-gray-500'}>
                    {pct.toFixed(0)}% used
                  </span>
                  <div className="flex items-center gap-2">
                    {isDanger && budget.hard_cap_enabled && (
                      <span className="px-2 py-0.5 bg-red-900/50 text-red-300 rounded text-xs">BLOCKED — Budget exhausted</span>
                    )}
                    {isWarning && (
                      <span className="px-2 py-0.5 bg-amber-900/50 text-amber-300 rounded text-xs">⚠ Approaching limit</span>
                    )}
                    {!isWarning && (
                      <span className="px-2 py-0.5 bg-green-900/50 text-green-300 rounded text-xs">✓ OK</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Top Spenders Tab ────────────────────────────────────────────── */}
      {!loading && activeTab === 'tenants' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OpenAI</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">WhatsApp</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Voice</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">% of Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {topTenants.map((t, i) => (
                <tr key={t.tenant_id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-sm text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{t.tenant_name || t.tenant_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-purple-300">{formatCurrency(t.openai_cents || 0)}</td>
                  <td className="px-4 py-3 text-sm text-green-300">{formatCurrency(t.whatsapp_cents || 0)}</td>
                  <td className="px-4 py-3 text-sm text-blue-300">{formatCurrency(t.voice_cents || 0)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-white">{formatCurrency(t.total_cents || 0)}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{t.pct_of_total?.toFixed(1)}%</td>
                  <td className="px-4 py-3">
                    <button className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded text-white">
                      Set Limits
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {topTenants.length === 0 && (
            <div className="text-center py-12 text-gray-500">No spending data yet</div>
          )}
        </div>
      )}

      {/* ── API Keys Tab ────────────────────────────────────────────────── */}
      {!loading && activeTab === 'keys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Active API Keys</h2>
            <button className="px-3 py-2 text-sm bg-yellow-600 hover:bg-yellow-700 rounded-lg text-white flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Add Key
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Spent</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Used</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {apiKeys.map(key => (
                  <tr key={key.id} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-sm font-medium text-white capitalize">{key.service}</td>
                    <td className="px-4 py-3">
                      <code className="px-2 py-0.5 bg-gray-800 rounded text-xs text-yellow-300 font-mono">
                        {key.key_prefix || '••••••••'}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {key.is_primary ? (
                        <span className="px-2 py-0.5 bg-green-900/50 text-green-300 rounded text-xs flex items-center gap-1 w-fit">
                          <CheckCircle className="w-3 h-3" /> Primary
                        </span>
                      ) : key.is_active ? (
                        <span className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded text-xs">Backup</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-red-900/50 text-red-300 rounded text-xs">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{formatCurrency(key.current_month_cents || 0)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 hover:bg-gray-700 rounded" title="Rotate Key">
                          <RotateCw className="w-4 h-4 text-blue-400" />
                        </button>
                        <button className="p-1.5 hover:bg-gray-700 rounded" title="Toggle">
                          <Shield className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Alerts Tab ──────────────────────────────────────────────────── */}
      {!loading && activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Usage Alerts</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{alerts.filter(a => !a.acknowledged).length} unacknowledged</span>
            </div>
          </div>

          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className={`bg-gray-900 border rounded-xl p-4 flex items-center justify-between ${
                !alert.acknowledged ? 'border-amber-800' : 'border-gray-800 opacity-60'
              }`}>
                <div className="flex items-center gap-3">
                  {alert.acknowledged ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-white capitalize">
                      {alert.alert_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-gray-400">
                      {alert.target_type === 'tenant' ? 'Tenant' : 'Platform'} · {alert.service}
                      {alert.message && ` — ${alert.message}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{new Date(alert.created_at).toLocaleString()}</span>
                  {!alert.acknowledged && (
                    <button className="px-2 py-1 text-xs bg-green-900/50 text-green-300 rounded hover:bg-green-900/70">
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {alerts.length === 0 && (
            <div className="text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
              <p className="text-gray-400">No alerts — everything is within budget</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, subtext, color }: {
  icon: React.ReactNode; label: string; value: string; subtext: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-800',
    red: 'from-red-500/20 to-red-600/5 border-red-800',
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
      <p className="text-xs text-gray-500 mt-1">{subtext}</p>
    </div>
  );
}
