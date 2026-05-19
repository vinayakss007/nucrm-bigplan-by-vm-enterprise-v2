'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, AlertTriangle, Building2, LogOut, User, Settings,
  ChevronDown, ArrowLeft, Bell, RefreshCw, Menu } from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import Link from 'next/link';

export default function SuperAdminHeader({ profile, stats, onToggleSidebar }: { profile: any; stats: any; onToggleSidebar?: () => void }) {
  const [showProfile, setShowProfile] = useState(false);
  const [health, setHealth] = useState<'ok'|'warn'|'error'>('ok');
  const profileRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const errors = stats?.open_errors ?? 0;
    setHealth(errors > 5 ? 'error' : errors > 0 ? 'warn' : 'ok');
  }, [stats]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!profileRef.current?.contains(e.target as Node)) setShowProfile(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method:'POST' });
    router.push('/auth/login');
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 sm:px-5 shrink-0">
      <div className="flex items-center gap-3 sm:gap-4">
        {onToggleSidebar && (
          <button onClick={onToggleSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors shrink-0">
            <Menu className="w-4 h-4" />
          </button>
        )}
        <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
          <Crown className="w-3.5 h-3.5" />
          <span>Super Admin</span>
        </div>
        <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
          <span><span className="text-foreground font-medium">{stats?.active_tenants ?? '—'}</span> active orgs</span>
          <span><span className="text-foreground font-medium">{stats?.total_tenants ?? '—'}</span> total</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/superadmin/health"
          className={cn('hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold transition-colors',
            health==='ok'?'border-emerald-300/20 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400':
            health==='warn'?'border-amber-300/20 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400':
            'border-red-300/20 dark:border-red-500/20 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400')}>
          <div className={cn('w-1.5 h-1.5 rounded-full',
            health==='ok'?'bg-emerald-500': health==='warn'?'bg-amber-500 animate-pulse':'bg-red-500 animate-pulse')} />
          {health==='ok'?'All Systems OK': `${stats?.open_errors} Open Error${stats?.open_errors > 1 ? 's' : ''}`}
        </Link>

        {(stats?.open_errors ?? 0) > 0 && (
          <Link href="/superadmin/errors" className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {(stats?.open_errors ?? 0) > 9 ? '9+' : stats?.open_errors}
            </span>
          </Link>
        )}

        <Link href="/tenant/dashboard"
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-violet-300 dark:hover:border-violet-500 transition-colors">
          <ArrowLeft className="w-3 h-3" />Exit Console
        </Link>

        <div className="relative" ref={profileRef}>
          <button onClick={()=>setShowProfile(s=>!s)}
            className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-accent transition-colors">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {getInitials(profile?.full_name||profile?.email||'SA')}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-foreground leading-tight">{profile?.full_name?.split(' ')[0]||'Admin'}</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">Super Admin</p>
            </div>
            <ChevronDown className={cn('w-3 h-3 text-muted-foreground transition-transform', showProfile&&'rotate-180')} />
          </button>

          {showProfile && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-border shadow-xl overflow-hidden z-50 bg-card">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs font-semibold text-foreground truncate">{profile?.full_name||'Super Admin'}</p>
                <p className="text-[10px] text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <div className="py-1">
                <Link href="/superadmin/settings" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Settings className="w-3.5 h-3.5"/>Platform Settings
                </Link>
                <Link href="/tenant/dashboard" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5"/>Back to CRM
                </Link>
              </div>
              <div className="border-t border-border py-1">
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                  <LogOut className="w-3.5 h-3.5"/>Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
