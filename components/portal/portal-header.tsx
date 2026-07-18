'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PortalSession {
  email: string;
  name: string;
  permissions: { quotes: boolean; invoices: boolean; cases: boolean };
  token: string;
}

function getStoredSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('portal_session');
    if (!raw) return null;
    const s = JSON.parse(raw) as PortalSession;
    if (!s.email || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export default function PortalHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    setSession(getStoredSession());
  }, [pathname]);

  const isLoginPage = pathname === '/portal/login';

  const logout = () => {
    localStorage.removeItem('portal_session');
    setSession(null);
    router.replace('/portal/login');
  };

  if (isLoginPage) return null;

  const navLinks = [
    { href: '/portal', label: 'Home' },
    ...(session?.permissions.cases ? [{ href: '/portal/tickets', label: 'Tickets' }] : []),
    ...(session?.permissions.invoices ? [{ href: '/portal/invoices', label: 'Invoices' }] : []),
    ...(session?.permissions.quotes ? [{ href: '/portal/quotes', label: 'Quotes' }] : []),
    { href: '/portal/kb', label: 'Help' },
  ];

  return (
    <header className="h-14 border-b border-border flex items-center px-6 bg-card sticky top-0 z-40">
      <Link href="/portal" className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-xs font-bold">N</div>
        <span className="font-bold text-sm">Customer Portal</span>
      </Link>

      <nav className="hidden sm:flex items-center gap-1 ml-8">
        {navLinks.map(link => (
          <Link key={link.href} href={link.href}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              pathname === link.href
                ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex-1" />

      {session && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-sm transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-[10px] font-bold text-violet-600">
              {session.name?.charAt(0)?.toUpperCase() || session.email.charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:inline text-xs font-medium max-w-[120px] truncate">{session.name || session.email}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-xl shadow-lg z-50 py-1 animate-scale-in">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium truncate">{session.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{session.email}</p>
                </div>
                <Link href="/portal/account"
                  className="block px-3 py-2 text-xs hover:bg-accent transition-colors"
                  onClick={() => setShowMenu(false)}>
                  My Account
                </Link>
                <button onClick={logout}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent text-red-600 flex items-center gap-2 transition-colors">
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}
