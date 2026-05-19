'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import TenantSidebar from './sidebar';
import TenantHeader from './header';
import PlanLimitBanner from '@/components/tenant/plan-limit-banner';
import EmailVerifyBanner from '@/components/tenant/email-verify-banner';
import ImpersonationBanner from '@/components/shared/impersonation-banner';
import { CommandPalette } from '@/components/shared/command-palette';
import { ShortcutsModal } from '@/components/shared/shortcuts-modal';

interface Props {
  tenant:any; profile:any; roleSlug:string;
  permissions:Record<string,boolean>; isAdmin:boolean; isSuperAdmin:boolean;
  emailVerified:boolean; email:string; children:React.ReactNode;
}

export default function TenantShell({ tenant, profile, roleSlug, permissions, isAdmin, isSuperAdmin, emailVerified, email, children }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openCommandPalette, setOpenCommandPalette] = useState(false);
  const [openShortcutsModal, setOpenShortcutsModal] = useState(false);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Persist sidebar preference
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    let keySequence: string[] = []
    let sequenceTimer: NodeJS.Timeout | null = null

    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K - Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpenCommandPalette(true);
        return;
      }

      // ? - Shortcuts modal (not in input)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setOpenShortcutsModal(true);
        }
        return;
      }

      // / - Focus search (not in input)
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          const searchInput = document.querySelector('[data-testid="search-input"]') as HTMLInputElement
            || document.querySelector('input[aria-label*="Search" i]') as HTMLInputElement;
          searchInput?.focus();
        }
      }

      // G + [key] - Go to navigation (sequential)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          keySequence = ['g'];
          if (sequenceTimer) clearTimeout(sequenceTimer);
          sequenceTimer = setTimeout(() => { keySequence = [] }, 1000);
          return;
        }
      }

      // Handle second key in sequence
      if (keySequence.length > 0 && e.key.length === 1) {
        const sequence = `g ${e.key.toLowerCase()}`;
        
        const routes: Record<string, string> = {
          'g d': '/tenant/dashboard',
          'g c': '/tenant/contacts',
          'g m': '/tenant/companies',
          'g p': '/tenant/deals',
          'g t': '/tenant/tasks',
          'g s': '/tenant/settings/general',
        };

        if (routes[sequence]) {
          e.preventDefault();
          window.location.href = routes[sequence];
          keySequence = [];
          if (sequenceTimer) clearTimeout(sequenceTimer);
          return;
        }
      }

      // N + [key] - New item shortcuts (sequential)
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          keySequence = ['n'];
          if (sequenceTimer) clearTimeout(sequenceTimer);
          sequenceTimer = setTimeout(() => { keySequence = [] }, 1000);
          return;
        }
      }

      // Handle N sequence for create actions
      if (keySequence.length > 0 && keySequence[0] === 'n' && e.key.length === 1) {
        const sequence = `n ${e.key.toLowerCase()}`;
        
        const createRoutes: Record<string, string> = {
          'n c': '/tenant/contacts?action=create',
          'n d': '/tenant/deals?action=create',
          'n m': '/tenant/companies?action=create',
          'n t': '/tenant/tasks?action=create',
          'n e': '/tenant/calendar?action=create',
        };

        if (createRoutes[sequence]) {
          e.preventDefault();
          window.location.href = createRoutes[sequence];
          keySequence = [];
          if (sequenceTimer) clearTimeout(sequenceTimer);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (sequenceTimer) clearTimeout(sequenceTimer);
    };
  }, []);

  // Listen for custom events from components
  useEffect(() => {
    const handleOpenShortcuts = () => setOpenShortcutsModal(true);
    const handleOpenImport = () => window.dispatchEvent(new CustomEvent('open-import-modal'));
    
    window.addEventListener('open-shortcuts-modal', handleOpenShortcuts);
    window.addEventListener('open-import-modal', handleOpenImport);
    
    return () => {
      window.removeEventListener('open-shortcuts-modal', handleOpenShortcuts);
      window.removeEventListener('open-import-modal', handleOpenImport);
    };
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
  };

  return (
    <>
      <ImpersonationBanner />
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Mobile overlay */}
        {/* Mobile overlay with fade animation */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden animate-in fade-in duration-200"
            onClick={()=>setMobileOpen(false)}
            role="button"
            aria-label="Close navigation menu"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setMobileOpen(false); }}
          />
        )}

        {/* Sidebar — desktop */}
        <div className="hidden md:block">
          <TenantSidebar
            tenant={tenant} profile={profile} roleSlug={roleSlug}
            permissions={permissions} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
            collapsed={collapsed} onToggle={toggle}
          />
        </div>

        {/* Sidebar — mobile drawer with slide animation */}
        {mobileOpen && (
          <div className="fixed left-0 top-0 h-full z-50 md:hidden animate-in slide-in-from-left duration-300">
            <TenantSidebar
              tenant={tenant} profile={profile} roleSlug={roleSlug}
              permissions={permissions} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
              collapsed={false} onToggle={()=>setMobileOpen(false)} onMobileClose={()=>setMobileOpen(false)}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!emailVerified && <EmailVerifyBanner email={email}/>}
          <PlanLimitBanner/>
          <TenantHeader
            tenant={tenant} profile={profile} roleSlug={roleSlug}
            onToggleSidebar={() => { if (window.innerWidth < 768) setMobileOpen(o=>!o); else toggle(); }}
          />
          <main id="main-content" className="flex-1 overflow-y-auto scrollbar-than p-4 sm:p-6" role="main">
            {children}
          </main>
        </div>
      </div>

      {/* Command Palette (⌘K) */}
      <CommandPalette open={openCommandPalette} onOpenChange={setOpenCommandPalette} />
      
      {/* Keyboard Shortcuts Modal (?) */}
      <ShortcutsModal open={openShortcutsModal} onOpenChange={setOpenShortcutsModal} />
    </>
  );
}
