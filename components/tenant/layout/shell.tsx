/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import TenantSidebar from './sidebar';
import TenantHeader from './header';
import PlanLimitBanner from '@/components/tenant/plan-limit-banner';
import EmailVerifyBanner from '@/components/tenant/email-verify-banner';
import ImpersonationBanner from '@/components/shared/impersonation-banner';
import { CommandPalette } from '@/components/shared/command-palette';
import { ShortcutsModal } from '@/components/shared/shortcuts-modal';
import { useHotkeys } from '@/components/shared/use-hotkeys';
import { setupCmdSSave } from '@/components/shared/save-shortcut';
import UserPreferencesApplier from '@/components/shared/user-preferences-applier';

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  // Escape key to close mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [mobileOpen]);

  // Focus trap inside mobile drawer
  useEffect(() => {
    if (!mobileOpen || !mobileDrawerRef.current) return;
    const drawer = mobileDrawerRef.current;

    // Focus first focusable element on open
    const timer = setTimeout(() => {
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0]?.focus();
    }, 100);

    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTabTrap);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleTabTrap);
    };
  }, [mobileOpen]);

  // Return focus to hamburger button when mobile drawer closes.
  // #1459: the selector queried aria-label="Toggle sidebar", but the actual
  // button (header.tsx) uses aria-label="Toggle navigation sidebar", so the
  // query always returned null and focus was never restored (WCAG 2.4.3).
  // Also only restore focus on an open->close transition, not on initial mount
  // (mobileOpen starts false), so we don't steal focus on page load.
  const drawerWasOpenRef = useRef(false);
  useEffect(() => {
    if (!mobileOpen) {
      if (drawerWasOpenRef.current) {
        const hamburger = document.querySelector('button[aria-label="Toggle navigation sidebar"]') as HTMLElement | null;
        hamburger?.focus();
      }
    } else {
      drawerWasOpenRef.current = true;
    }
  }, [mobileOpen]);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Persist sidebar preference
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  // Global keyboard shortcuts (/ , g c , g d , ? ...) — mounted once here (#1119)
  useHotkeys({
    onOpenCommandPalette: () => setOpenCommandPalette(true),
    onToggleShortcutsDialog: () => setOpenShortcutsModal(o => !o),
  });

  // ⌘S / Ctrl+S — save the current form by clicking its submit button (#1119).
  // Mounted once; returns a cleanup that removes the listener.
  useEffect(() => setupCmdSSave(), []);

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
      <UserPreferencesApplier />
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
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed left-0 top-0 h-full z-50 md:hidden animate-in slide-in-from-left duration-300"
          >
            <TenantSidebar
              tenant={tenant} profile={profile} roleSlug={roleSlug}
              permissions={permissions} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
              collapsed={false} onToggle={()=>setMobileOpen(false)} onMobileClose={()=>setMobileOpen(false)}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!emailVerified && <EmailVerifyBanner email={email} emailVerified={emailVerified}/>}
          <PlanLimitBanner/>
          <TenantHeader
            tenant={tenant} profile={profile} roleSlug={roleSlug}
            onToggleSidebar={() => { if (window.innerWidth < 768) setMobileOpen(o=>!o); else toggle(); }}
          />
          <main id="main-content" className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-5 page-enter" role="main">
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
