'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, CreditCard, BarChart3,
  Settings, LogOut, Crown, ArrowLeft, Activity, Heart,
  Database, AlertTriangle, MessageSquare, Megaphone, TrendingUp, Gauge, Zap,
  X, Menu, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { section: 'Overview' },
  { href:'/superadmin/dashboard',      label:'Overview',       icon:LayoutDashboard },
  { href:'/superadmin/monitoring',     label:'Monitoring',     icon:Activity },
  { href:'/superadmin/health',         label:'System Health',  icon:Heart },
  { section: 'Business' },
  { href:'/superadmin/tenants',        label:'Tenants',        icon:Building2 },
  { href:'/superadmin/users',          label:'All Users',      icon:Users },
  { href:'/superadmin/revenue',        label:'Revenue',        icon:TrendingUp },
  { href:'/superadmin/billing',        label:'Plans & Billing',icon:CreditCard },
  { href:'/superadmin/usage',          label:'Usage',          icon:Gauge },
  { section: 'Operations' },
  { href:'/superadmin/backups',        label:'Backups',        icon:Database },
  { href:'/superadmin/selective-restore', label:'Selective Restore', icon:RotateCcw },
  { href:'/superadmin/errors',         label:'Error Logs',     icon:AlertTriangle },
  { href:'/superadmin/tickets',        label:'Support Tickets',icon:MessageSquare },
  { href:'/superadmin/announcements',  label:'Announcements',  icon:Megaphone },
  { section: 'Config' },
  { href:'/superadmin/analytics',      label:'Analytics',      icon:BarChart3 },
  { href:'/superadmin/modules',        label:'Modules',        icon:Zap },
  { href:'/superadmin/settings',       label:'Settings',       icon:Settings },
];

interface Props {
  profile: any;
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function SuperAdminSidebar({ profile, collapsed, onToggle }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
    router.refresh();
  };

  const isActive = (href: string) => pathname === href || (href !== '/superadmin/dashboard' && pathname.startsWith(href));
  const navItems = NAV.filter((n: any) => !('section' in n));

  // ── Collapsed mini-sidebar ──
  if (collapsed) {
    return (
      <aside className="w-[56px] shrink-0 h-full flex flex-col items-center py-2 gap-0.5 transition-all duration-200 overflow-y-auto bg-card border-r border-border">
        <button onClick={onToggle} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors mt-1 mb-2" title="Open sidebar">
          <Menu className="w-4 h-4" />
        </button>

        {navItems.map((item: any) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} title={item.label}
              className={cn('w-9 h-9 flex items-center justify-center rounded-lg transition-all hover:bg-accent',
                active ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400' : 'text-muted-foreground/70')}>
              <item.icon className="w-4 h-4" />
            </Link>
          );
        })}

        <Link href="/tenant/dashboard" title="My CRM"
          className="w-9 h-9 flex items-center justify-center rounded-lg mt-auto mb-1 text-violet-400 hover:bg-violet-500/10 transition-colors">
          <Building2 className="w-4 h-4" />
        </Link>

        <button onClick={logout} title="Sign out"
          className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
          <LogOut className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  // ── Full sidebar ──
  return (
    <aside className="w-[240px] shrink-0 h-full flex flex-col transition-all duration-200 bg-card border-r border-border">

      {/* Logo header */}
      <div className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Crown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-foreground text-sm tracking-tight">NuCRM</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">ADMIN</span>
        </div>
        <button onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Minimize sidebar">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* My CRM — super admin's own workspace */}
      <Link href="/tenant/dashboard"
        className="flex items-center gap-2 mx-3 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 shrink-0">
        <Building2 className="w-3.5 h-3.5" />My CRM
      </Link>

      {/* Scrollable navigation */}
      <nav className="flex-1 py-2 px-2.5 overflow-y-auto scrollbar-thin space-y-0.5">
        {NAV.map((item: any, i: number) => {
          if ('section' in item) {
            return <p key={i} className="px-3 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">{(item as any).section}</p>;
          }
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}
              className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all',
                active ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' : 'text-muted-foreground/80 hover:bg-accent hover:text-foreground')}>
              <item.icon className="w-3.5 h-3.5 shrink-0" />{item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-2.5 shrink-0 border-t border-border">
        <button onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium mb-1 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 dark:hover:text-red-400 text-muted-foreground">
          <LogOut className="w-3.5 h-3.5" />Sign out
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(profile?.full_name||profile?.email||'S').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name||'Super Admin'}</p>
            <p className="text-[10px] truncate text-muted-foreground">{profile?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
