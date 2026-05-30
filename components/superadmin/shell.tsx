'use client';
import { useState, useEffect } from 'react';
import SuperAdminSidebar from './sidebar';
import SuperAdminHeader from './header';

export default function SuperAdminShell({ user, stats, children }: { user: any; stats: any; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  
  useEffect(() => {
    const saved = localStorage.getItem('superadmin_sidebar_collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);
  
  const toggle = () => {
    if (window.innerWidth < 768) {
      setMobileOpen(o => !o);
    } else {
      setCollapsed(o => {
        const next = !o;
        localStorage.setItem('superadmin_sidebar_collapsed', String(next));
        return next;
      });
    }
  };

  return (
    <div className="dark flex h-screen overflow-hidden bg-gray-950">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" 
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden md:block">
        <SuperAdminSidebar profile={user} collapsed={collapsed} onToggle={toggle} />
      </div>

      {/* Sidebar - Mobile Drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:hidden ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <SuperAdminSidebar profile={user} collapsed={false} onToggle={() => setMobileOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SuperAdminHeader profile={user} stats={stats} onToggleSidebar={toggle} />
        <main id="main-content" className="flex-1 overflow-y-auto scrollbar-thin p-3 sm:p-4 bg-gray-950" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}
