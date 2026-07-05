'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, User, Mail, Shield, Calendar, Globe, Palette, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface UserDetail {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  phone?: string;
  timezone?: string;
  is_super_admin?: boolean;
  email_verified?: boolean;
  oauth_provider?: string;
  locale?: string;
  theme?: string;
  created_at?: string;
  membership_count?: number;
  memberships?: {
    tenant_id: string;
    tenant_name: string;
    role_slug: string;
    status: string;
    created_at?: string;
  }[];
}

export default function UserDetailPage() {
  const params = useParams();
  const userId = params['id'] as string;
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/superadmin/users/${userId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setUser(data.data);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <Link href="/superadmin/users" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Users
        </Link>
        <div className="admin-card p-8 text-center">
          <p className="text-muted-foreground">User not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/superadmin/users" className="p-2 rounded-lg hover:bg-accent text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <User className="w-5 h-5 text-violet-500" />
            {user.full_name || user.email}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2 items-center">
          {user.is_super_admin && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Super Admin
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.email_verified ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {user.email_verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
      </div>

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Profile */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Profile</h3>
          <div className="space-y-2 text-sm">
            {user.full_name && (
              <p><span className="text-muted-foreground">Name:</span> {user.full_name}</p>
            )}
            <p className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" /> {user.email}
            </p>
            {user.phone && (
              <p><span className="text-muted-foreground">Phone:</span> {user.phone}</p>
            )}
            {user.oauth_provider && (
              <p><span className="text-muted-foreground">OAuth:</span> {user.oauth_provider}</p>
            )}
          </div>
        </div>

        {/* Preferences */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Preferences</h3>
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" /> Locale: {user.locale || 'en'}
            </p>
            <p className="flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-muted-foreground" /> Theme: {user.theme || 'light'}
            </p>
            <p><span className="text-muted-foreground">Timezone:</span> {user.timezone || 'UTC'}</p>
          </div>
        </div>

        {/* Dates */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Dates</h3>
          <p className="text-sm flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            Joined: {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
          </p>
        </div>

        {/* Memberships */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Memberships</h3>
          <p className="text-sm">{user.membership_count ?? 0} active tenant{user.membership_count !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Membership List */}
      {user.memberships && user.memberships.length > 0 && (
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Tenant Memberships</h3>
          <div className="space-y-2">
            {user.memberships.map((m) => (
              <div key={m.tenant_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <Link href={`/superadmin/tenants/${m.tenant_id}`} className="text-sm font-medium hover:underline">
                    {m.tenant_name}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{m.role_slug}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
