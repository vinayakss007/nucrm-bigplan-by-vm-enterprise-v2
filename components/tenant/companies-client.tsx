'use client';
import { useState, useCallback } from 'react';
import { Plus, Search, Building2, Globe, Users, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function TenantCompaniesClient({ initialCompanies, permissions, tenantId, userId }: any) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editCo, setEditCo] = useState<any>(null);
  const router = useRouter();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = companies.filter((c: any) => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const reload = useCallback(async () => {
    const res = await fetch('/api/tenant/companies');
    const data = await res.json();
    setCompanies(data.data || []);
    setShowForm(false); setEditCo(null);
  }, []);

  const del = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/tenant/companies/${id}`, { method: 'DELETE' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (res.ok) { setCompanies((p: any[]) => p.filter(c => c.id !== id)); toast.success('Deleted'); }
    else toast.error('Failed to delete');
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
        </div>
        {permissions.canCreate
          ? <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> Add Company</button>
          : <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs text-muted-foreground border border-border opacity-60 cursor-not-allowed"><Lock className="w-3.5 h-3.5" />Add Company</div>
        });
      </div>
      {!filtered.length ? (
        <div className="text-center py-16"><Building2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" /><p className="font-semibold">No companies {search ? 'found' : 'yet'}</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c: any) => (
            <div key={c.id} className="admin-card p-5 hover:shadow-md hover:border-violet-200 dark:hover:border-violet-800 transition-all cursor-pointer group"
              onClick={() => router.push(`/tenant/companies/${c.id}`)}>
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">{c.name.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate group-hover:text-violet-600 transition-colors">{c.name}</h3>
                  {c.industry && <p className="text-xs text-muted-foreground">{c.industry}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="w-3.5 h-3.5" />{c.contact_count || 0} contacts</span>
                {c.website && <a href={c.website} target="_blank" onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-xs text-violet-600 hover:underline"><Globe className="w-3 h-3" />Website</a>}
              </div>
              {(permissions.canEdit || permissions.canDelete) && (
                <div className="flex gap-1.5 mt-3 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  {permissions.canEdit && <button onClick={() => { setEditCo(c); setShowForm(true); }} className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors">Edit</button>}
                  {permissions.canDelete && <button onClick={(e) => del(c.id, e)} className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-colors">Delete</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {showForm && <CompanyFormModal company={editCo} tenantId={tenantId} userId={userId} onSaved={reload} onClose={() => { setShowForm(false); setEditCo(null); }} />}
    </div>
  );
}

function CompanyFormModal({ company, _tenantId, _userId, onSaved, onClose }: any) {
  const [form, setForm] = useState({ name: company?.name||'', industry: company?.industry||'', size: company?.size||'', website: company?.website||'', phone: company?.phone||'', address: company?.address||'', notes: company?.notes||'' });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (f: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [f]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const res = await fetch(`/api/tenant/companies${company ? '/' + company.id : ''}`, {
      method: company ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || 'Failed'); setSaving(false); return; }
    toast.success(company ? 'Updated' : 'Company created');
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border"><h2 className="font-semibold">{company ? 'Edit Company' : 'New Company'}</h2><button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button></div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Company Name *</label><input required value={form.name} onChange={set('name')} className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Industry</label><input value={form.industry} onChange={set('industry')} className={inp} /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Size</label>
              <select value={form.size} onChange={set('size')} className={inp}><option value="">Select</option>{['1-10','11-50','51-200','201-500','501-1000','1000+'].map(s => <option key={s}>{s}</option>)}</select>
            </div>
          </div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Website</label><input value={form.website} onChange={set('website')} className={inp} placeholder="https://..." /></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label><input value={form.phone} onChange={set('phone')} className={inp} /></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label><textarea value={form.notes} onChange={set('notes')} rows={2} className={inp + ' resize-none'} /></div>
          <div className="flex gap-3"><button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button><button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">{saving ? 'Saving...' : company ? 'Save' : 'Create'}</button></div>
        </form>
      </div>
    </div>
  );
}
