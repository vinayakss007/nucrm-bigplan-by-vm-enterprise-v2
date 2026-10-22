/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import Link from 'next/link';
import { ArrowLeft, Shield, Plus, Edit, Trash2, Save, Lock, ChevronDown, Check, Crown, X, Loader2 } from 'lucide-react';
import { PERMISSIONS, PERMISSION_CATEGORIES } from '@/lib/permissions/definitions';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';
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
  const queryClient = useQueryClient();
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // #1328: parallel reads via TanStack Query (were raw fetch + useEffect).
  const tenantQuery = useApiQuery<{ data?: { id: string; name: string }; id?: string; name?: string }>(
    ['superadmin', 'tenant', tenantId],
    `/api/superadmin/tenants/${tenantId}`,
    { enabled: !!tenantId },
  );
  const rolesQuery = useApiQuery<{ data?: Role[] }>(
    ['superadmin', 'tenant-roles', tenantId],
    `/api/superadmin/tenants/${tenantId}/roles`,
    { enabled: !!tenantId },
  );
  const loading = tenantQuery.isLoading || rolesQuery.isLoading;
  const tenantData = tenantQuery.data;
  const rolesData = rolesQuery.data;
  const tenant: { id: string; name: string } | null =
    (tenantQuery.data?.data ?? (tenantQuery.data as { id: string; name: string } | undefined)) ?? null;
  const roles: Role[] = rolesQuery.data?.data ?? [];

  // #2872: all three writes — `saveRole`'s PATCH, `createRoleMutation`'s POST, `deleteRoleMutation`'s
  // DELETE — end in `invalidateRoles()`, which re-reads BOTH keys, so "rows kept, error set" is the
  // ordinary state right after the operator creates, edits or retires a role, and `useQuery` keeps
  // the previous `data` when a revalidation rejects (no `keepPreviousData` here; it is the default).
  // This page bound neither read's `error` to anything, so the roster just sat there. The tenant key
  // is the detail page's too (`['superadmin', 'tenant', tenantId]` in app/superadmin/tenants/[id]/page.tsx).
  // The three writes are named by their handler, not by their line: this page's own failure handling
  // is what moved those lines, and a number only the file's next editor can keep true is a claim.
  const tenantFailed = Boolean(tenantQuery.error) && !tenantData;
  const tenantStale = Boolean(tenantQuery.error) && Boolean(tenantData);
  const tenantReason = tenantQuery.error?.message || 'no response from the server';
  const rolesFailed = Boolean(rolesQuery.error) && !rolesData;
  const rolesStale = Boolean(rolesQuery.error) && Boolean(rolesData);
  const rolesReason = rolesQuery.error?.message || 'no response from the server';
  // A 404 is an answer about the RECORD, and only one read here can give it: GET
  // /api/superadmin/tenants/[id] replies 'Tenant not found' for an id that does not resolve
  // (route.ts:25, :59), while the roles route answers 200 with an empty list for a tenant that
  // has no roles (:80). "No response from the server" about a deleted tenant is wrong twice
  // over, and "Try again" cannot fix it.
  const notFound = (tenantFailed && tenantQuery.error?.status === 404)
    || (rolesFailed && rolesQuery.error?.status === 404);

  const invalidateRoles = () => {
    queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenant', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenant-roles', tenantId] });
  };

  const saveRoleMutation = useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: string; permissions: Record<string, boolean> }) => {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      return data;
    },
    onSuccess: () => { toast.success('Permissions updated'); invalidateRoles(); },
    onError: (e: Error) => toast.error(e.message || 'Failed to save'),
  });

  const createRoleMutation = useMutation({
    mutationFn: async ({
      name,
      description,
      permissions,
    }: {
      name: string;
      description: string;
      permissions: Record<string, boolean>;
    }) => {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, permissions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      return data;
    },
    onSuccess: () => { toast.success('Role created'); invalidateRoles(); },
    onError: (e: Error) => toast.error(e.message || 'Failed to create'),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}/roles/${roleId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      return data;
    },
    onSuccess: () => { toast.success('Role deleted'); invalidateRoles(); },
    onError: (e: Error) => toast.error(e.message || 'Failed to delete'),
  });

  const saveRole = (roleId: string, permissions: Record<string, boolean>) => {
    saveRoleMutation.mutate({ roleId, permissions });
  };

  const createRole = (name: string, description: string, permissions: Record<string, boolean>) => {
    createRoleMutation.mutate({ name, description, permissions });
  };

  const deleteRole = async (roleId: string, roleName: string) => {
    await confirmThen(`Delete role "${roleName}"? Users with this role will need reassignment.`, async () => {
      deleteRoleMutation.mutate(roleId);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The record is gone: the server answered, and what it answered is that there is no tenant
  // here — nothing below may offer to create a role for it.
  if (notFound) {
    return (
      <div className="space-y-4 max-w-6xl">
        <Link href="/superadmin/tenants" className="p-2 rounded-lg hover:bg-accent text-muted-foreground inline-flex">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="admin-card p-8 text-center space-y-2">
          <p className="font-semibold">No tenant with this id</p>
          <p className="text-sm text-muted-foreground">
            The organization this page was opened for does not exist, so there is nothing here to manage.
          </p>
        </div>
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
            {tenant?.name ?? 'This organization'} — Role Permissions
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

      {/* The organization read feeds only the name above, and still gets its own banner and its
          own retry. The writes stay offered over it: every route here addresses the tenant by the
          path id and checks it server-side (roles/route.ts:48, [roleId]/route.ts:62, :142), so
          none of them needs a name this page did not read. */}
      {tenantFailed && (
        <InlineErrorState
          message={`Failed to load this organization: ${tenantReason}. Its name is all this page could not read — the role list comes from a different request and is shown on its own terms below.`}
          onRetry={() => void tenantQuery.refetch()}
        />
      )}
      {tenantStale && (
        <InlineErrorState
          message={`Could not refresh, so the organization name above is the last read: ${tenantReason}. A rename or a status change made since then is not shown here, and it does not change which role rows or permissions the list below holds.`}
          onRetry={() => void tenantQuery.refetch()}
        />
      )}

      {/* #2872: the operator's own create / save / delete all end in `invalidateRoles()`, which
          re-reads this key, so this is the ordinary state after a write that succeeded. What the
          refusal hides, per control: a role created since is missing, one retired since is still
          listed and still clickable, and each card's permission tally and member count were
          computed off this read. Create stays live — POST refuses a taken name rather than
          writing a second role (roles/route.ts:109-131, 409) — and Delete stays live, acting on
          the row's own id, which the server 404s once it is gone ([roleId]/route.ts:181). The
          PATCH that replaces a role's whole permission map is the write nothing can refuse: its
          guard is opted into by a field this page never sends ([roleId]/route.ts:85-87, :95;
          lib/api/concurrency.ts:31), so the cost is said in the editor's own caveat — and that
          editor only opens from a card, which requires this read to have answered. */}
      {rolesStale && (
        <InlineErrorState
          message={`Could not refresh, so the role cards below are the last read: ${rolesReason}. A role created since this was fetched is missing, one retired since is still listed and still clickable, and the permission tally and member count on each card are what this read saw — saving from a card rewrites that role's whole permission map from them.`}
          onRetry={() => void rolesQuery.refetch()}
        />
      )}

      {/* Roles List */}
      <div className="space-y-4">
        {rolesFailed && (
          <InlineErrorState
            message={`Failed to load this organization's roles: ${rolesReason}. This is not "there are none" — the read never answered, so nothing here can show what already exists. New Role still creates, and the server refuses a name that is taken rather than letting a second one through; what no one can tell you is whether one already had it.`}
            onRetry={() => void rolesQuery.refetch()}
          />
        )}
        {!rolesFailed && roles.length === 0 && (
          <div className="admin-card p-6 text-center text-sm text-muted-foreground">
            No roles configured for this organization.
          </div>
        )}
        {!rolesFailed && roles.map(role => {
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
          rolesStale={rolesStale}
          rolesReason={rolesReason}
          onSave={(roleData) => {
            if (editRole) {
              saveRole(editRole.id, roleData.permissions);
            } else {
              createRole(roleData.name ?? "", roleData.description ?? "", roleData.permissions);
            }
            setShowEditor(false);
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}

function RoleEditorModal({ role, rolesStale, rolesReason, onSave, onClose }: {
  role: Role | null;
  rolesStale: boolean;
  rolesReason: string;
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
            {/* This form's write is a whole-map replace of one role's permissions
                ([roleId]/route.ts:80 — `patch.permissions` overwrites the column) built from the
                row it was opened on, so over a refused refresh the cost is said here, where the
                checkboxes are, and not only in the banner up the page. */}
            {role && rolesStale && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                These checkboxes start from the permission map this list last read ({rolesReason}).
                Saving replaces that whole map on the server, so a permission granted elsewhere
                since the read is not on this screen and cannot be kept by this save.
              </p>
            )}
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
