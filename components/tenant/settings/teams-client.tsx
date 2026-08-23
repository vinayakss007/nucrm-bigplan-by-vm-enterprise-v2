/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Plus, Trash2, UserMinus, Loader2, Crown } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';

interface Person { userId: string; name: string; }
interface TeamMemberVM { userId: string; role: string; name: string; }
interface TeamVM {
  id: string;
  name: string;
  description?: string;
  managerId?: string;
  isActive: boolean;
  memberCount: number;
  members: TeamMemberVM[];
}

interface Props {
  initialTeams: TeamVM[];
  people: Person[];
}

export default function TeamsClient({ initialTeams, people }: Props) {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamVM[]>(initialTeams);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [managerId, setManagerId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addUser, setAddUser] = useState<Record<string, string>>({});

  const personName = (id?: string) => people.find((p) => p.userId === id)?.name ?? '—';

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/tenant/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, managerId: managerId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create team');
      toast.success('Team created');
      setName(''); setDescription(''); setManagerId(''); setCreating(false);
      router.refresh();
      setTeams((prev) => [...prev, { ...data.data, memberCount: managerId ? 1 : 0, members: [] }].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setBusy(false);
    }
  }

  async function deleteTeam(team: TeamVM) {
    confirmThen(
      `Delete team "${team.name}"? Leads and contacts keep working; they simply lose this team tag.`,
      async () => {
        const res = await fetch(`/api/tenant/teams/${team.id}`, { method: 'DELETE' });
        if (!res.ok) { toast.error('Failed to delete team'); return; }
        toast.success('Team deleted');
        setTeams((prev) => prev.filter((t) => t.id !== team.id));
        router.refresh();
      },
    );
  }

  async function addMember(teamId: string) {
    const userId = addUser[teamId];
    if (!userId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tenant/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: 'member' }),
      });
      if (!res.ok) throw new Error();
      toast.success('Member added');
      setTeams((prev) => prev.map((t) => t.id === teamId
        ? { ...t, members: [...t.members.filter((m) => m.userId !== userId), { userId, role: 'member', name: personName(userId) }], memberCount: t.members.some((m) => m.userId === userId) ? t.memberCount : t.memberCount + 1 }
        : t));
      setAddUser((prev) => ({ ...prev, [teamId]: '' }));
    } catch {
      toast.error('Failed to add member');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(teamId: string, userId: string) {
    const res = await fetch(`/api/tenant/teams/${teamId}/members?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to remove member'); return; }
    toast.success('Member removed');
    setTeams((prev) => prev.map((t) => t.id === teamId
      ? { ...t, members: t.members.filter((m) => m.userId !== userId), memberCount: Math.max(0, t.memberCount - 1) }
      : t));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Teams</h1>
            <p className="text-sm text-muted-foreground">Group reps into Sales, Marketing or Support. Assignment rules and reports can target a team.</p>
          </div>
        </div>
        <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> New team
        </button>
      </div>

      {creating && (
        <form onSubmit={createTeam} className="admin-card p-4 space-y-3">
          <input className="w-full px-3 py-2 rounded-lg border border-border bg-card" placeholder="Team name (e.g., Sales)" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="w-full px-3 py-2 rounded-lg border border-border bg-card" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select aria-label="Team manager" className="w-full px-3 py-2 rounded-lg border border-border bg-card" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">No manager</option>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCreating(false)} className="flex-1 px-3 py-2 rounded-lg border border-border text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create
            </button>
          </div>
        </form>
      )}

      {teams.length === 0 ? (
        <div className="admin-card p-8 text-center text-muted-foreground">
          No teams yet. Create one to route leads to a group of reps.
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => (
            <div key={team.id} className="admin-card p-4">
              <div className="flex items-center justify-between gap-3">
                <button className="text-left flex-1" onClick={() => setExpanded(expanded === team.id ? null : team.id)}>
                  <div className="font-semibold flex items-center gap-2">
                    {team.name}
                    <span className="text-xs text-muted-foreground font-normal">{team.memberCount} member{team.memberCount === 1 ? '' : 's'}</span>
                  </div>
                  {team.description && <div className="text-sm text-muted-foreground">{team.description}</div>}
                  {team.managerId && <div className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1"><Crown className="w-3 h-3" /> {personName(team.managerId)}</div>}
                </button>
                <button onClick={() => deleteTeam(team)} aria-label={`Delete ${team.name}`} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {expanded === team.id && (
                <div className="mt-4 pt-4 border-t border-border space-y-3">
                  {team.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {team.members.map((m) => (
                        <li key={m.userId} className="flex items-center justify-between text-sm py-1">
                          <span className="inline-flex items-center gap-2">
                            {m.role === 'manager' && <Crown className="w-3 h-3 text-amber-500" />}
                            {m.name}
                          </span>
                          <button onClick={() => removeMember(team.id, m.userId)} aria-label={`Remove ${m.name}`} className="p-1 rounded hover:bg-destructive/10 text-destructive">
                            <UserMinus className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <select aria-label="Add member" className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm" value={addUser[team.id] ?? ''} onChange={(e) => setAddUser((prev) => ({ ...prev, [team.id]: e.target.value }))}>
                      <option value="">Add a member…</option>
                      {people.filter((p) => !team.members.some((m) => m.userId === p.userId)).map((p) => (
                        <option key={p.userId} value={p.userId}>{p.name}</option>
                      ))}
                    </select>
                    <button onClick={() => addMember(team.id)} disabled={busy || !addUser[team.id]} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm inline-flex items-center gap-1">
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
