'use client';
import { useState, useEffect } from 'react';
import { Shield, Users, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { SUPER_ADMIN_ROLES, SUPER_ADMIN_PERMISSIONS, SUPER_ADMIN_ROLE_SLUGS } from '@/lib/permissions/super-admin-permissions';

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  super_admin_role: string;
}

export default function AccessControlPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/superadmin/access-control');
      const data = await res.json();
      setAdmins(data.data || []);
    } catch {
      toast.error('Failed to load admin users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateRole = async (userId: string, newRole: string) => {
    setSaving(userId);
    try {
      const res = await fetch('/api/superadmin/access-control', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Role updated');
        load();
      } else {
        toast.error(data.error || 'Failed to update role');
      }
    } catch {
      toast.error('Failed to update role');
    } finally {
      setSaving(null);
    }
  };

  // Group permissions by category
  const categories = [...new Set(SUPER_ADMIN_PERMISSIONS.map(p => p.category))];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-violet-400" />
          Access Control
        </h1>
        <p className="text-xs text-white/30">Manage super admin roles and permissions</p>
      </div>

      {/* Admin Users Table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
          <Users className="w-4 h-4 text-white/40" />
          <p className="text-sm font-semibold text-white">Super Admin Users</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-white/30 animate-spin" />
          </div>
        ) : admins.length === 0 ? (
          <div className="text-center py-12 text-white/30 text-sm">No super admin users found</div>
        ) : (
          <div className="divide-y divide-white/5">
            {admins.map(admin => (
              <div key={admin.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{admin.full_name || admin.email}</p>
                  <p className="text-xs text-white/30 truncate">{admin.email}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <select
                    value={admin.super_admin_role || 'super_admin_full'}
                    onChange={(e) => updateRole(admin.id, e.target.value)}
                    disabled={saving === admin.id}
                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-sm text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  >
                    {SUPER_ADMIN_ROLE_SLUGS.map(slug => (
                      <option key={slug} value={slug}>
                        {SUPER_ADMIN_ROLES[slug]!.label}
                      </option>
                    ))}
                  </select>
                  {saving === admin.id && <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permissions Matrix */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10">
          <p className="text-sm font-semibold text-white">Permissions Matrix</p>
          <p className="text-xs text-white/20 mt-0.5">Shows which permissions are granted to each role</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-2 text-left text-white/40 font-medium">Permission</th>
                {SUPER_ADMIN_ROLE_SLUGS.map(slug => (
                  <th key={slug} className="px-3 py-2 text-center text-white/40 font-medium whitespace-nowrap">
                    {SUPER_ADMIN_ROLES[slug]!.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.flatMap(category => [
                <tr key={`cat-${category}`} className="border-b border-white/5">
                  <td colSpan={SUPER_ADMIN_ROLE_SLUGS.length + 1} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/20 bg-white/[0.02]">
                    {category}
                  </td>
                </tr>,
                ...SUPER_ADMIN_PERMISSIONS.filter(p => p.category === category).map(perm => (
                  <tr key={perm.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-white/60">{perm.label}</td>
                    {SUPER_ADMIN_ROLE_SLUGS.map(slug => (
                      <td key={slug} className="px-3 py-2 text-center">
                        {SUPER_ADMIN_ROLES[slug]!.permissions[perm.id] ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mx-auto" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-white/10 mx-auto" />
                        )}
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
