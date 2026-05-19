'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Plus, Edit, Trash2, Save, Lock, ChevronDown, Check, Crown, Users, Settings, X, Loader2 } from 'lucide-react';
import { PERMISSIONS, PERMISSION_CATEGORIES } from '@/lib/permissions/definitions';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const DANGER_COLORS: Record<string, string> = { safe: 'text-emerald-500', moderate: 'text-amber-500', danger: 'text-red-500' };

interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  permissions: Record<string, boolean>;
  is_system: boolean;
  user_count: number;
}

export default function TenantRolesPage() {
  const params = useParams();
  const tenantId = params['id'] as string;
  const [tenant, setTenant] = useState<any>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(PERMISSION_CATEGORIES[0] ?? null);

  const load = useCallback(async () => {
    try {
      const [tenantRes, rolesRes] = await Promise.all([
        fetch(`/api/superadmin/tenants/${tenantId}`).then(r => r.json()),
        fetch(`/api/tenant/roles`).then(r => r.json()),
      ]);
      setTenant(tenantRes.data || tenantRes);
      setRoles(rolesRes.data || []);
    } catch (error) {
      console.error('Failed to load', error);
      toast.error('Failed to load tenant data');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const saveRole = async (roleId: string, permissions: Record<string, boolean>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast.success('Permissions updated');
      load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const createRole = async (name: string, description: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/superadmin/tenants/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      toast.success('Role created');
      load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (roleId: string, roleName: string) => {
    if (!confirm(`Delete role "${roleName}"? Users with this role will need reassignment.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/superadmin/tenants/roles/${roleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      toast.success('Role deleted');
      load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/superadmin/tenants" className="p-2 rounded-lg hover:bg-accent text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-violet-500" />
            {tenant?.name} — Role Permissions
          </h1>
          <p className="text-sm text-muted-foreground">Manage granular permissions for this organization</p>
        </div>
        <button
          onClick={() => {
            setEditRole(null);
            setShowEditor(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Role
        </button>
      </div>

      {/* Roles List */}
      <div className="space-y-4">
        {roles.map(role => {
          const grantedCount = role.permissions?.['all'] === true
            ? PERMISSIONS.length
            : Object.values(role.permissions || {}).filter(Boolean).length;

          return (
            <div key={role.id} className="admin-card p-5 group">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center shrink-0">
                    {role.slug === 'admin' ? (
                      <Crown className="w-5 h-5 text-amber-500" />
                    ) : (
                      <Shield className="w-5 h-5 text-violet-600" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{role.name}</p>
                      {role.is_system && (
                        <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />System
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                        {role.user_count} user{role.user_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {role.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {grantedCount}/{PERMISSIONS.length} permissions
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      setEditRole(role);
                      setShowEditor(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors"
                  >
                    <Edit className="w-3 h-3" />
                    {role.is_system ? 'View' : 'Edit'}
                  </button>
                  {!role.is_system && (
                    <button
                      onClick={() => deleteRole(role.id, role.name)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 text-muted-foreground transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Permission Editor Modal */}
      {showEditor && (
        <RoleEditorModal
          role={editRole}
          onSave={(roleData) => {
            if (editRole) {
              saveRole(editRole.id, roleData.permissions);
            } else {
              createRole(roleData.name ?? "", roleData.description ?? "");
            }
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}

function RoleEditorModal({ role, onSave, onClose }: {
  role: Role | null;
  onSave: (data: { name?: string; description?: string; permissions: Record<string, boolean> }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [permissions, setPermissions] = useState<Record<string, boolean>>(role?.permissions || {});
  const [openCat, setOpenCat] = useState<string | null>(PERMISSION_CATEGORIES[0] ?? null);

  const toggle = (id: string) => setPermissions(p => ({ ...p, [id]: !p[id] }));
  const setCatAll = (cat: string, val: boolean) => {
    const catPs = PERMISSIONS.filter(p => p.category === cat);
    setPermissions(prev => {
      const n = { ...prev };
      catPs.forEach(p => { n[p.id] = val; });
      return n;
    });
  };

  const granted = Object.values(permissions).filter(Boolean).length;
  const isSystem = role?.is_system ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold">{role ? `Edit: ${role.name}` : 'New Role'}</h2>
            <p className="text-xs text-muted-foreground">{granted}/{PERMISSIONS.length} permissions</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-4">
          {!role && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Role Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Custom Role Name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="What this role is for..."
                />
              </div>
            </div>
          )}

          {/* Permissions by Category */}
          {PERMISSION_CATEGORIES.map(cat => {
            const catPs = PERMISSIONS.filter(p => p.category === cat);
            const catGranted = catPs.filter(p => permissions[p.id]).length;
            const open = openCat === cat;

            return (
              <div key={cat} className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenCat(open ? null : cat)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Shield className="w-4 h-4 text-violet-500" />
                    <span className="text-sm font-semibold">{cat}</span>
                    <span className="text-xs text-muted-foreground">{catGranted}/{catPs.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isSystem && (
                      <>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setCatAll(cat, true); }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setCatAll(cat, false); }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        >
                          None
                        </button>
                      </>
                    )}
                    <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                  </div>
                </button>

                {open && (
                  <div className="divide-y divide-border">
                    {catPs.map(perm => {
                      const g = permissions[perm.id] || false;
                      return (
                        <div
                          key={perm.id}
                          className={cn('flex items-center gap-3 px-4 py-3 transition-colors', g ? 'bg-emerald-50/50 dark:bg-emerald-950/10' : 'hover:bg-accent/50')}
                        >
                          <button
                            type="button"
                            onClick={() => !isSystem && toggle(perm.id)}
                            disabled={isSystem}
                            className={cn(
                              'w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0',
                              g ? 'bg-emerald-500 border-emerald-500' : 'border-border hover:border-violet-400',
                              isSystem && 'opacity-60 cursor-not-allowed'
                            )}
                          >
                            {g && <Check className="w-3 h-3 text-white" />}
                          </button>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{perm.label}</p>
                            <p className="text-xs text-muted-foreground">{perm.description}</p>
                          </div>
                          <span className={cn('text-[10px] font-semibold', DANGER_COLORS[perm.dangerLevel])}>
                            {perm.dangerLevel === 'danger' ? '⚠ Destructive' : perm.dangerLevel === 'moderate' ? '● Write' : '● Read'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 p-5 border-t border-border shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => onSave({ name, description, permissions })}
            disabled={!name.trim() && !role}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save className="w-3.5 h-3.5" />
            {role ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}
