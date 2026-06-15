'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Zap, ToggleRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const CAT_COLORS: Record<string, string> = {
  utility: 'bg-white/5 text-white/40',
  automation: 'bg-violet-500/15 text-violet-400',
  messaging: 'bg-emerald-500/15 text-emerald-400',
  integration: 'bg-blue-500/15 text-blue-400',
  ai: 'bg-amber-500/15 text-amber-400',
  analytics: 'bg-orange-500/15 text-orange-400',
};

export default function TenantModulesPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params['id'] as string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modules, setModules] = useState<any[]>([]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tenant, setTenant] = useState<any>(null);
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch(`/api/superadmin/tenants/${tenantId}/modules`);
    const d = await res.json();
    setModules(d.data || []);
    setPlan(d.plan || 'free');
    setLoading(false);
  };

  useEffect(() => { load(); }, [, load]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toggleModule = async (mod: any) => {
    setToggling(mod.id);
    const action = mod.status === 'active' ? 'disable' : 'install';
    const res = await fetch(`/api/superadmin/tenants/${tenantId}/modules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_id: mod.id, action, force_enabled: !mod.planAllowed }),
    });
    if (res.ok) {
      toast.success(action === 'install' ? 'Module enabled' : 'Module disabled');
      load();
    } else { const d = await res.json(); toast.error(d.error); }
    setToggling(null);
  };

  const totalEnabled = modules.filter(m => m.status === 'active').length;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/superadmin/tenants')}
          className="p-2 rounded-lg border border-white/10 text-white/40 hover:text-white hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400" />Tenant Modules
          </h1>
          <p className="text-xs text-white/40">
            Plan: <span className="capitalize font-semibold text-white/60">{plan}</span> · {totalEnabled}/{modules.length} active
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-white/10 text-white/40 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl animate-pulse bg-white/5" />
        ))
      ) : (
        <div className="space-y-2">
          {modules.map(mod => {
            const isActive = mod.status === 'active';
            const planBlocks = !mod.planAllowed && !isActive;
            return (
              <div key={mod.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-lg mt-0.5">{mod.icon || '🔌'}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white">{mod.name}</p>
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize', CAT_COLORS[mod.category] || CAT_COLORS['utility'])}>
                        {mod.category}
                      </span>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">{mod.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {mod.features?.slice(0, 4).map((f: string) => (
                        <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">{f}</span>
                      ))}
                      {mod.features?.length > 4 && (
                        <span className="text-[9px] text-white/20">+{mod.features.length - 4} more</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => toggleModule(mod)} disabled={toggling === mod.id}
                  className={cn('flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors shrink-0 ml-3 disabled:opacity-50',
                    isActive
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                      : planBlocks
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                        : 'border-white/10 bg-white/5 text-white/30 hover:text-white'
                  )}>
                  {toggling === mod.id ? '...' : isActive ? <><ToggleRight className="w-3 h-3" /> Active</> : planBlocks ? 'Override On' : 'Install'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
