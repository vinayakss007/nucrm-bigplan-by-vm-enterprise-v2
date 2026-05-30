'use client';

import { useState, useEffect } from 'react';
import {
  Brain,
  RotateCw,
  AlertTriangle,
  CheckCircle,
  X,
  Loader2,
  Edit3,
  RotateCcw,
} from 'lucide-react';

interface TenantUsage {
  tenant_id: string;
  name: string;
  slug: string;
  plan_id: string;
  plan_name: string;
  tokens_used: number;
  tokens_limit: number;
  has_override: boolean;
  percentage: number;
  status: 'ok' | 'warning' | 'exceeded' | 'unlimited';
  reset_at: string | null;
}

export default function SuperAdminAiTokens() {
  const [tenants, setTenants] = useState<TenantUsage[]>([]);
  const [totalUsed, setTotalUsed] = useState(0);
  const [billingPeriod, setBillingPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/ai-token-settings');
      const data = await res.json();
      if (data.tenants) setTenants(data.tenants);
      if (data.total_tokens_used != null) setTotalUsed(data.total_tokens_used);
      if (data.billing_period) setBillingPeriod(data.billing_period);
    } catch (err) {
      console.error('Failed to load AI token data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSetLimit = async (tenantId: string) => {
    const limit = parseInt(editLimit, 10);
    if (isNaN(limit)) return;
    setSaving(true);
    try {
      await fetch('/api/superadmin/ai-token-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, tokens_limit: limit }),
      });
      setEditingTenant(null);
      setEditLimit('');
      await loadData();
    } catch (err) {
      console.error('Failed to set limit:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (tenantId: string) => {
    if (!confirm('Reset this tenant\'s AI token usage to 0?')) return;
    setSaving(true);
    try {
      await fetch('/api/superadmin/ai-token-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, action: 'reset' }),
      });
      await loadData();
    } catch (err) {
      console.error('Failed to reset usage:', err);
    } finally {
      setSaving(false);
    }
  };

  const formatTokens = (n: number) => {
    if (n === -1) return 'Unlimited';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'exceeded': return 'text-red-400';
      case 'warning': return 'text-amber-400';
      case 'unlimited': return 'text-purple-400';
      default: return 'text-green-400';
    }
  };

  const getRowBorder = (status: string) => {
    switch (status) {
      case 'exceeded': return 'border-l-red-500';
      case 'warning': return 'border-l-amber-500';
      default: return 'border-l-transparent';
    }
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-amber-500';
    if (percentage >= 60) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="w-7 h-7 text-purple-400" />
            AI Token Settings
          </h1>
          <p className="text-gray-400 mt-1">
            Monitor and control AI token usage per tenant - Period: {billingPeriod || '...'}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2 text-white"
        >
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-purple-500/20 to-purple-600/5 border border-purple-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <Brain className="w-5 h-5" />
            <span className="text-xs uppercase tracking-wider">Total Tokens Used</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatTokens(totalUsed)}</p>
          <p className="text-xs text-gray-500 mt-1">across all tenants this month</p>
        </div>
        <div className="bg-gradient-to-br from-green-500/20 to-green-600/5 border border-green-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <CheckCircle className="w-5 h-5" />
            <span className="text-xs uppercase tracking-wider">Healthy</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {tenants.filter(t => t.status === 'ok' || t.status === 'unlimited').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">tenants within limits</p>
        </div>
        <div className="bg-gradient-to-br from-red-500/20 to-red-600/5 border border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 mb-1">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-xs uppercase tracking-wider">Exceeded / Warning</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {tenants.filter(t => t.status === 'exceeded' || t.status === 'warning').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">tenants at or over limit</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      )}

      {/* Table */}
      {!loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monthly Limit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Used</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {tenants.map((t) => (
                <tr
                  key={t.tenant_id}
                  className={`hover:bg-gray-800/30 border-l-4 ${getRowBorder(t.status)}`}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300 capitalize">{t.plan_name}</td>
                  <td className="px-4 py-3">
                    {editingTenant === t.tenant_id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editLimit}
                          onChange={(e) => setEditLimit(e.target.value)}
                          placeholder="-1 for unlimited"
                          className="w-28 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white"
                        />
                        <button
                          onClick={() => handleSetLimit(t.tenant_id)}
                          disabled={saving}
                          className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 rounded text-white"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setEditingTenant(null); setEditLimit(''); }}
                          className="px-1 py-1 text-xs text-gray-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-300">
                        {formatTokens(t.tokens_limit)}
                        {t.has_override && (
                          <span className="ml-1 text-xs text-purple-400">(override)</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-white font-mono">
                    {formatTokens(t.tokens_used)}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === 'unlimited' ? (
                      <span className="text-xs text-purple-400">Unlimited</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="w-20 bg-gray-800 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${getProgressColor(t.percentage)}`}
                            style={{ width: `${Math.min(100, t.percentage)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400">{t.percentage}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium uppercase ${getStatusColor(t.status)}`}>
                      {t.status === 'ok' && '✓ OK'}
                      {t.status === 'warning' && '⚠ Warning'}
                      {t.status === 'exceeded' && '✕ Exceeded'}
                      {t.status === 'unlimited' && '∞ Unlimited'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingTenant(t.tenant_id);
                          setEditLimit(String(t.tokens_limit));
                        }}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                        title="Set custom limit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleReset(t.tenant_id)}
                        disabled={saving}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-amber-400"
                        title="Reset usage"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tenants.length === 0 && (
            <div className="text-center py-12 text-gray-500">No tenants found</div>
          )}
        </div>
      )}
    </div>
  );
}
