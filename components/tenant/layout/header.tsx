'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Sun, Moon, Search, LogOut, X, Users, TrendingUp,
  Building2, Menu, ChevronDown, User, Settings, Crown, KeyRound, RefreshCw, UserCheck, CheckSquare,
  Mail, AlertCircle, Info } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { cn, formatCurrency, getInitials, formatRelativeTime, toSnakeCase } from '@/lib/utils';

interface Tenant {
  primary_color?: string;
}

interface Profile {
  full_name?: string;
  email?: string;
  is_super_admin?: boolean;
}

interface Notification {
  id: string;
  type?: string;
  read_at?: string;
  is_read?: boolean;
  link?: string;
  title?: string;
  message?: string;
  body?: string;
  created_at?: string;
}

interface SearchLead {
  id: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
}

interface SearchContact {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface SearchDeal {
  id: string;
  title?: string;
  value?: number;
}

interface SearchCompany {
  id: string;
  name?: string;
}

interface SearchTask {
  id: string;
  title?: string;
  priority?: string;
}

interface SearchResults {
  leads?: SearchLead[];
  contacts?: SearchContact[];
  deals?: SearchDeal[];
  companies?: SearchCompany[];
  tasks?: SearchTask[];
}

export default function TenantHeader({ tenant, profile, roleSlug, onToggleSidebar }: {
  tenant: Tenant; profile: Profile; roleSlug: string; onToggleSidebar?: () => void;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread]       = useState(0);
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [showDrop, setShowDrop]   = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const { theme, setTheme }       = useTheme();
  const [_mounted, setMounted]     = useState(false);
  const router                    = useRouter();
  const inputRef                  = useRef<HTMLInputElement>(null);
  const timerRef                  = useRef<NodeJS.Timeout>(undefined);
  const searchRef                 = useRef<HTMLDivElement>(null);
  const profileRef                = useRef<HTMLDivElement>(null);
  const notifRef                  = useRef<HTMLDivElement>(null);

  const color = tenant?.primary_color || '#7c3aed';

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node))  setShowDrop(false);
      if (!profileRef.current?.contains(e.target as Node)) setShowProfile(false);
      if (!notifRef.current?.contains(e.target as Node))   setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const [unreadRes, notifRes] = await Promise.all([
        fetch('/api/tenant/notifications/unread'),
        fetch('/api/tenant/notifications'),
      ]);
      const [unreadData, notifData] = await Promise.all([
        unreadRes.json(),
        notifRes.json(),
      ]);
      setUnread(unreadData.count ?? 0);
      setNotifications((notifData.data ?? []).slice(0, 8).map((n: Record<string, unknown>) => toSnakeCase(n) as Notification));
    } catch (error) {
      console.error('[header] Failed to load notifications:', error);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const iv = setInterval(loadNotifications, 60_000);
    return () => clearInterval(iv);
  }, [loadNotifications]);

  useEffect(() => {
    try {
      const bc = new BroadcastChannel('nucrm_auth');
      bc.addEventListener('message', e => { if (e.data==='logout') { router.push('/auth/login'); router.refresh(); } });
      return () => bc.close();
    } catch (error) {
      console.error('[header] BroadcastChannel error:', error);
      // Fallback to default on corrupted storage data
    }
  }, [router]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const res = await fetch(`/api/tenant/search?q=${encodeURIComponent(q)}&limit=20`);
    const data = await res.json();
    setResults(data); setSearching(false); setShowDrop(true);
  }, []);

  const markNotifRead = async (id: string) => {
    await fetch('/api/tenant/notifications', {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }),
    });
    setNotifications(prev => prev.map(n => n.id===id ? {...n, is_read:true} : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const handleChange = (val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) { setResults(null); setShowDrop(false); return; }
    timerRef.current = setTimeout(() => doSearch(val), 250);
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    try { new BroadcastChannel('nucrm_auth').postMessage('logout'); } catch (e) { console.error('[header] broadcast failed:', e); }
    router.push('/auth/login');
    router.refresh();
  };

  const total = results ? (results.contacts?.length??0)+(results.deals?.length??0)+(results.companies?.length??0) : 0;
  const initials = getInitials(profile?.full_name || profile?.email || 'U');

  return (
    <header className="h-14 border-b border-border bg-card flex items-center gap-3 px-4 shrink-0">
      {/* Hamburger to toggle sidebar */}
      <button onClick={onToggleSidebar}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent text-muted-foreground transition-colors shrink-0">
        <Menu className="w-4 h-4" />
      </button>

      {/* Search bar */}
      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <div className="relative">
          {searching
            ? <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/>
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>}
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => { if (results) setShowDrop(true); }}
            onKeyDown={e => {
              if (e.key==='Enter') { setShowDrop(true); }
              if (e.key==='Escape') { setShowDrop(false); setQuery(''); setResults(null); }
            }}
            placeholder="Search contacts, deals, companies..."
            data-testid="search-input"
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-background transition-colors"
          />
          {query && <button onClick={()=>{setQuery('');setResults(null);setShowDrop(false);}} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5"/></button>}
        </div>

        {/* Search dropdown */}
        {showDrop && query && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
            {total === 0 && !searching ? (
              <div className="px-4 py-5 text-center text-sm text-muted-foreground">No results for "{query}"</div>
            ) : (
              <>
                {results?.leads?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><UserCheck className="w-3 h-3"/>Leads</div>
                  {results?.leads?.map((l) => (
                    <Link key={l.id} href={`/tenant/leads/${l.id}`} onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">{l.first_name?.charAt(0)?.toUpperCase()}</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{l.first_name} {l.last_name}</p>{l.company_name&&<p className="text-xs text-muted-foreground truncate">{l.company_name}</p>}</div>
                    </Link>
                  ))}
                </>}
                {results?.contacts?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Users className="w-3 h-3"/>Contacts</div>
                  {results?.contacts?.map((c) => (
                    <Link key={c.id} href={`/tenant/contacts/${c.id}`} onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">{c.first_name?.charAt(0)?.toUpperCase()}</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{c.first_name} {c.last_name}</p>{c.email&&<p className="text-xs text-muted-foreground truncate">{c.email}</p>}</div>
                    </Link>
                  ))}
                </>}
                {results?.deals?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><TrendingUp className="w-3 h-3"/>Deals</div>
                  {results?.deals?.map((d) => (
                    <Link key={d.id} href="/tenant/deals" onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <TrendingUp className="w-4 h-4 text-amber-500 shrink-0"/>
                      <div className="flex-1 min-w-0"><p className="text-sm truncate">{d.title}</p></div>
                      <span className="text-sm font-bold text-violet-600 shrink-0">{formatCurrency(Number(d.value))}</span>
                    </Link>
                  ))}
                </>}
                {results?.companies?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><Building2 className="w-3 h-3"/>Companies</div>
                  {results?.companies?.map((c) => (
                    <Link key={c.id} href={`/tenant/companies/${c.id}`} onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <Building2 className="w-4 h-4 text-blue-500 shrink-0"/>
                      <p className="text-sm flex-1 truncate">{c.name}</p>
                    </Link>
                  ))}
                </>}
                {results?.tasks?.length>0 && <>
                  <div className="px-4 py-1.5 bg-muted/30 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5"><CheckSquare className="w-3 h-3"/>Tasks</div>
                  {results?.tasks?.map((t) => (
                    <Link key={t.id} href="/tenant/tasks" onClick={()=>{setShowDrop(false);setQuery('');setResults(null);}}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', t.priority==='high' ? 'bg-red-500' : t.priority==='medium' ? 'bg-amber-500' : 'bg-slate-400')} />
                      <p className="text-sm flex-1 truncate">{t.title}</p>
                    </Link>
                  ))}
                </>}
              </>
            )}
          </div>
        )}

      </div>

      {/* Right side */}
      <div className="flex items-center gap-1 ml-auto shrink-0">
        {/* Refresh button */}
        <button onClick={()=>router.refresh()} title="Refresh page"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <RefreshCw className="w-4 h-4"/>
        </button>

        {/* Dark mode toggle */}
        <button onClick={()=>setTheme(theme==='dark'?'light':'dark')}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground">
          <Sun className="w-4 h-4 hidden dark:block" />
          <Moon className="w-4 h-4 block dark:hidden" />
        </button>

        {/* Notifications bell */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setShowNotifPanel(s => !s)}
            className={cn("relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent transition-colors", showNotifPanel ? "bg-accent text-violet-600" : "text-muted-foreground")}>
            <Bell className="w-4 h-4"/>
            {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-violet-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-in zoom-in">{unread > 99 ? '99+' : unread}</span>}
          </button>

          {showNotifPanel && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
                <p className="text-sm font-bold">Notifications</p>
                {unread > 0 && <button onClick={async () => {
                  await fetch('/api/tenant/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_all_read' }) });
                  setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
                  setUnread(0);
                }} className="text-[10px] font-bold text-violet-600 hover:text-violet-700 uppercase tracking-wider">Mark all read</button>}
              </div>
              
              <div className="max-h-[350px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-8 py-10 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3 opacity-50">
                      <Bell className="w-6 h-6 text-muted-foreground"/>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">All caught up!</p>
                    <p className="text-xs text-muted-foreground mt-1">No new notifications</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {notifications.slice(0, 5).map((n) => {
                      const Icon = n.type === 'lead' ? UserCheck : n.type === 'deal' ? TrendingUp : n.type === 'task' ? CheckSquare : n.type === 'email' ? Mail : n.type === 'alert' ? AlertCircle : Info;
                      const isUnread = !n.read_at && !n.is_read;
                      return (
                        <div key={n.id} onClick={() => { if(isUnread) markNotifRead(n.id); if(n.link) router.push(n.link); setShowNotifPanel(false); }}
                          className={cn("px-4 py-3 cursor-pointer hover:bg-accent transition-colors flex gap-3 items-start text-left", isUnread && "bg-violet-50/30 dark:bg-violet-900/5")}>
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600")}>
                            <Icon className="w-4 h-4"/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs leading-normal", isUnread ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>{n.title || n.message || n.body || ''}</p>
                            {n.body && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                            <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
                              <span className="w-1 h-1 rounded-full bg-border"/> {formatRelativeTime(n.created_at)}
                            </p>
                          </div>
                          {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-violet-600 mt-1.5 shrink-0 shadow-[0_0_8px_rgba(124,58,237,0.5)]"/>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              <Link href="/tenant/notifications" onClick={() => setShowNotifPanel(false)}
                className="block py-2.5 text-center text-xs font-bold text-muted-foreground hover:text-violet-600 bg-muted/10 hover:bg-muted/30 border-t border-border transition-all capitalize">
                View all notifications
              </Link>
            </div>
          )}
        </div>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button onClick={()=>setShowProfile(s=>!s)}
            className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl hover:bg-accent transition-colors">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0" style={{ background: color }}>
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold leading-tight max-w-[100px] truncate">{profile?.full_name?.split(' ')[0] || 'User'}</p>
              <p className="text-[10px] text-muted-foreground leading-tight capitalize">{roleSlug?.replace(/_/g,' ')}</p>
            </div>
            <ChevronDown className={cn('w-3 h-3 text-muted-foreground transition-transform', showProfile && 'rotate-180')}/>
          </button>

          {showProfile && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
              {/* User info */}
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <p className="text-sm font-semibold truncate">{profile?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <div className="py-1">
                <Link href="/tenant/settings/profile" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <User className="w-3.5 h-3.5 text-muted-foreground"/>My Profile
                </Link>
                <Link href="/tenant/settings/sessions" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground"/>Active Sessions
                </Link>
                <Link href="/tenant/settings/general" onClick={()=>setShowProfile(false)}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent transition-colors">
                  <Settings className="w-3.5 h-3.5 text-muted-foreground"/>Settings
                </Link>
                {profile?.is_super_admin && (
                  <Link href="/superadmin/dashboard" onClick={()=>setShowProfile(false)}
                    className="flex items-center gap-3 px-4 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors">
                    <Crown className="w-3.5 h-3.5"/>Super Admin
                  </Link>
                )}
              </div>
              <div className="border-t border-border py-1">
                <button onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                  <LogOut className="w-3.5 h-3.5"/>Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
