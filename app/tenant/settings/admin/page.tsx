/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2, Users, CreditCard, TrendingUp, AlertCircle, Clock, Crown, Settings, Shield } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { getFromCache, setInCache } from '@/lib/client-cache';
import SettingsEmptyState from '@/components/shared/settings-empty-state';

interface OrgTenant {
  name?: string;
  status?: string;
  trial_ends_at?: string | null;
}
interface Org {
  tenant?: OrgTenant;
  plan?: Plan;
  usage?: Usage;
}
interface Plan {
  name?: string;
  price_monthly?: number;
  price_yearly?: number;
  max_contacts?: number;
  max_deals?: number;
  max_users?: number;
  max_automations?: number;
}
interface Member {
  id: string;
  full_name?: string | null;
  email?: string;
  role_slug?: string;
}
interface Usage {
  current_contacts?: number;
  current_deals?: number;
}
interface AdminOverview {
  org: Org | null;
  plan: Plan | null;
  members: Member[];
  usage: Usage;
}

export default function OrganizationAdminPage() {
  const cacheKey = 'org:admin:overview';
  
  // Initialize from cache for instant loading
  const cachedData = typeof window !== 'undefined' ? getFromCache<AdminOverview>(cacheKey) : null;
  
  const [loading, setLoading] = useState(!cachedData);
  const [org, setOrg] = useState<Org | null>(cachedData?.org || null);
  const [plan, setPlan] = useState<Plan | null>(cachedData?.plan || null);
  const [members, setMembers] = useState<Member[]>(cachedData?.members || []);
  const [usage, setUsage] = useState<Usage>(cachedData?.usage || {});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [orgRes, membersRes] = await Promise.all([
        fetch('/api/tenant/workspace', { signal }),
        fetch('/api/tenant/members', { signal })
      ]);

      const orgData = await orgRes.json();
      const membersData = await membersRes.json();

      if (signal?.aborted) return;

      const data = {
        org: orgData,
        plan: orgData.plan || {},
        members: membersData.data || [],
        usage: orgData.usage || {},
      };
      
      setOrg(data.org);
      setPlan(data.plan);
      setMembers(data.members);
      setUsage(data.usage);
      
      // Cache for 5 minutes
      setInCache(cacheKey, data, { ttl: 5 * 60 * 1000 });
      setLoading(false);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast.error('Failed to load organization data');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    
    // Auto-refresh every 3 minutes
    const interval = setInterval(() => {
      const cached = getFromCache<AdminOverview>(cacheKey);
      if (cached) {
        setOrg(cached.org);
        setPlan(cached.plan);
        setMembers(cached.members);
        setUsage(cached.usage);
      }
    }, 3 * 60 * 1000);
    
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentUsers = members.length;
  const maxUsers = plan?.max_users || 1;
  const userUsagePercent = maxUsers < 0 ? 0 : (currentUsers / maxUsers) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Organization Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your organization, team, and subscription
        </p>
      </div>

      {/* Organization Info */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Organization Card */}
        <div className="p-5 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold">{org?.tenant?.name}</h3>
              <p className="text-xs text-muted-foreground">Organization</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium capitalize">{plan?.name || 'Free'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={cn(
                "font-medium capitalize",
                org?.tenant?.status === 'active' ? 'text-emerald-600' :
                org?.tenant?.status === 'trialing' ? 'text-amber-600' :
                'text-red-600'
              )}>
                {org?.tenant?.status || 'active'}
              </span>
            </div>
            {org?.tenant?.trial_ends_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trial Ends</span>
                <span className="font-medium">{formatDate(org.tenant.trial_ends_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Team Card */}
        <div className="p-5 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold">Team</h3>
              <p className="text-xs text-muted-foreground">Members</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-bold">
              {currentUsers} <span className="text-sm text-muted-foreground">/ {maxUsers < 0 ? '∞' : maxUsers}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className={cn(
                  "h-2 rounded-full transition-all",
                  userUsagePercent > 90 ? 'bg-red-500' :
                  userUsagePercent > 70 ? 'bg-amber-500' :
                  'bg-emerald-500'
                )}
                style={{ width: `${Math.min(userUsagePercent, 100)}%` }}
              />
            </div>
            <Link href="/tenant/settings/team" className="text-xs text-violet-600 hover:underline">
              Manage team →
            </Link>
          </div>
        </div>

        {/* Billing Card */}
        <div className="p-5 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold">Billing</h3>
              <p className="text-xs text-muted-foreground">Subscription</p>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly</span>
              <span className="font-medium">
                {plan?.price_monthly ? formatCurrency(plan.price_monthly) : 'Free'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yearly</span>
              <span className="font-medium">
                {plan?.price_yearly ? formatCurrency(plan.price_yearly) : 'N/A'}
              </span>
            </div>
            <Link href="/tenant/settings/billing" className="text-xs text-violet-600 hover:underline">
              Manage billing →
            </Link>
          </div>
        </div>
      </div>

      {/* Usage Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <UsageStatCard
          icon={Users}
          label="Contacts"
          current={usage.current_contacts || 0}
          max={plan?.max_contacts || 500}
          color="violet"
        />
        <UsageStatCard
          icon={TrendingUp}
          label="Deals"
          current={usage.current_deals || 0}
          max={plan?.max_deals || 100}
          color="amber"
        />
        <UsageStatCard
          icon={Users}
          label="Users"
          current={currentUsers}
          max={maxUsers}
          color="blue"
        />
        <UsageStatCard
          icon={Shield}
          label="Automations"
          current={0}
          max={plan?.max_automations || 5}
          color="emerald"
        />
      </div>

      {/* Quick Actions */}
      <div className="p-5 rounded-xl border border-border bg-card">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Quick Actions
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/tenant/settings/team"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Users className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Manage Team</p>
              <p className="text-xs text-muted-foreground">Invite or remove members</p>
            </div>
          </Link>
          <Link
            href="/tenant/settings/billing"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <CreditCard className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Upgrade Plan</p>
              <p className="text-xs text-muted-foreground">Get more features</p>
            </div>
          </Link>
          <Link
            href="/tenant/settings/general"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Organization Settings</p>
              <p className="text-xs text-muted-foreground">Name, branding, etc.</p>
            </div>
          </Link>
          <Link
            href="/tenant/settings/roles"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Crown className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Roles & Permissions</p>
              <p className="text-xs text-muted-foreground">Custom roles</p>
            </div>
          </Link>
          <Link
            href="/tenant/settings/api-keys"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Shield className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">API Keys</p>
              <p className="text-xs text-muted-foreground">Developer access</p>
            </div>
          </Link>
          <Link
            href="/tenant/settings/audit"
            className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Audit Log</p>
              <p className="text-xs text-muted-foreground">Activity history</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Team Members Preview */}
      <div className="p-5 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" />
            Team Members
          </h3>
          <Link
            href="/tenant/settings/team"
            className="text-sm text-violet-600 hover:underline flex items-center gap-1"
          >
            See all <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="space-y-2">
          {members.slice(0, 3).map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                  {member.full_name?.charAt(0)?.toUpperCase() || member.email?.charAt(0)?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{member.full_name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-1 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-400 capitalize">
                  {member.role_slug || 'member'}
                </span>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <SettingsEmptyState icon={Users} title="No team members yet" description="Invite your first member to get started" />
          )}
        </div>
      </div>

      {/* Alerts */}
      {userUsagePercent > 90 && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-600">User Limit Almost Reached</p>
              <p className="text-sm text-red-600/70 mt-1">
                You're using {currentUsers} of {maxUsers} user seats. Upgrade your plan to add more team members.
              </p>
              <Link
                href="/tenant/settings/billing"
                className="inline-block mt-2 text-sm text-red-600 hover:underline font-medium"
              >
                Upgrade Plan →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface UsageStatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  current: number;
  max: number;
  color: string;
}
function UsageStatCard({ icon: Icon, label, current, max, color }: UsageStatCardProps) {
  const percent = max < 0 ? 0 : (current / max) * 100;
  const colorClasses: Record<string, string> = {
    violet: 'bg-violet-500/10 text-violet-600',
    amber: 'bg-amber-500/10 text-amber-600',
    blue: 'bg-blue-500/10 text-blue-600',
    emerald: 'bg-emerald-500/10 text-emerald-600',
  };

  return (
    <div className="p-4 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", colorClasses[color] ?? colorClasses['violet'])}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold mb-2">
        {current} <span className="text-sm text-muted-foreground">/ {max < 0 ? '∞' : max}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className={cn("h-1.5 rounded-full transition-all", ((colorClasses[color] ?? colorClasses['violet']) as string).split(' ')[1])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
