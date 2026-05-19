'use client';
import { useState } from 'react';
import { Book, Search, ChevronDown, Code, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const ENDPOINTS = [
  {
    section: 'Auth',
    routes: [
      { method: 'POST', path: '/api/auth/login', desc: 'Login with email + password', auth: false },
      { method: 'POST', path: '/api/auth/signup', desc: 'Create workspace + owner account', auth: false },
      { method: 'POST', path: '/api/auth/logout', desc: 'End current session', auth: true },
      { method: 'POST', path: '/api/auth/forgot-password', desc: 'Send password reset email', auth: false },
      { method: 'POST', path: '/api/auth/reset-password', desc: 'Reset password with token', auth: false },
    ],
  },
  {
    section: 'Contacts',
    routes: [
      { method: 'GET', path: '/api/tenant/contacts', desc: 'List contacts (paginated)', auth: true },
      { method: 'POST', path: '/api/tenant/contacts', desc: 'Create contact', auth: true },
      { method: 'GET', path: '/api/tenant/contacts/:id', desc: 'Get contact detail', auth: true },
      { method: 'PATCH', path: '/api/tenant/contacts/:id', desc: 'Update contact', auth: true },
      { method: 'DELETE', path: '/api/tenant/contacts/:id', desc: 'Delete contact', auth: true },
    ],
  },
  {
    section: 'Deals',
    routes: [
      { method: 'GET', path: '/api/tenant/deals', desc: 'List deals (paginated)', auth: true },
      { method: 'POST', path: '/api/tenant/deals', desc: 'Create deal', auth: true },
      { method: 'GET', path: '/api/tenant/deals/:id', desc: 'Get deal detail', auth: true },
      { method: 'PATCH', path: '/api/tenant/deals/:id', desc: 'Update deal (stage, value, etc)', auth: true },
      { method: 'DELETE', path: '/api/tenant/deals/:id', desc: 'Delete deal', auth: true },
    ],
  },
  {
    section: 'Tasks',
    routes: [
      { method: 'GET', path: '/api/tenant/tasks', desc: 'List tasks', auth: true },
      { method: 'POST', path: '/api/tenant/tasks', desc: 'Create task', auth: true },
      { method: 'PATCH', path: '/api/tenant/tasks/:id', desc: 'Update task', auth: true },
      { method: 'DELETE', path: '/api/tenant/tasks/:id', desc: 'Delete task', auth: true },
    ],
  },
  {
    section: 'Companies',
    routes: [
      { method: 'GET', path: '/api/tenant/companies', desc: 'List companies', auth: true },
      { method: 'POST', path: '/api/tenant/companies', desc: 'Create company', auth: true },
      { method: 'PATCH', path: '/api/tenant/companies/:id', desc: 'Update company', auth: true },
      { method: 'DELETE', path: '/api/tenant/companies/:id', desc: 'Delete company', auth: true },
    ],
  },
  {
    section: 'Tickets',
    routes: [
      { method: 'GET', path: '/api/tenant/tickets', desc: 'List support tickets', auth: true },
      { method: 'POST', path: '/api/tenant/tickets', desc: 'Create ticket', auth: true },
      { method: 'GET', path: '/api/tenant/tickets/:id', desc: 'Get ticket with replies', auth: true },
      { method: 'PATCH', path: '/api/tenant/tickets/:id', desc: 'Update ticket status', auth: true },
      { method: 'POST', path: '/api/tenant/tickets/:id/replies', desc: 'Add reply to ticket', auth: true },
    ],
  },
  {
    section: 'Knowledge Base',
    routes: [
      { method: 'GET', path: '/api/tenant/kb/articles', desc: 'List KB articles', auth: true },
      { method: 'POST', path: '/api/tenant/kb/articles', desc: 'Create article', auth: true },
      { method: 'GET', path: '/api/tenant/kb/articles/:id', desc: 'Get article', auth: true },
      { method: 'PATCH', path: '/api/tenant/kb/articles/:id', desc: 'Update article', auth: true },
      { method: 'DELETE', path: '/api/tenant/kb/articles/:id', desc: 'Delete article', auth: true },
    ],
  },
  {
    section: 'Plugin Engine',
    routes: [
      { method: 'GET', path: '/api/tenant/plugin-engine', desc: 'List installed integrations', auth: true },
      { method: 'POST', path: '/api/tenant/plugin-engine', desc: 'Add new integration', auth: true },
      { method: 'PATCH', path: '/api/tenant/plugin-engine', desc: 'Update integration config', auth: true },
      { method: 'DELETE', path: '/api/tenant/plugin-engine', desc: 'Remove integration', auth: true },
      { method: 'POST', path: '/api/tenant/plugin-engine/actions', desc: 'Execute integration action', auth: true },
    ],
  },
  {
    section: 'Public API',
    routes: [
      { method: 'GET', path: '/api/public/tickets', desc: 'Portal: list tickets by email', auth: false },
      { method: 'POST', path: '/api/public/tickets', desc: 'Portal: create ticket', auth: false },
      { method: 'GET', path: '/api/public/kb/articles', desc: 'Public KB articles', auth: false },
      { method: 'GET', path: '/api/public/kb/articles/:id', desc: 'Public KB article detail', auth: false },
      { method: 'GET', path: '/api/public/invoices', desc: 'Portal: list invoices by email', auth: false },
    ],
  },
  {
    section: 'Customer Portal',
    routes: [
      { method: 'GET', path: '/portal', desc: 'Portal home', auth: false },
      { method: 'GET', path: '/portal/tickets', desc: 'My tickets', auth: false },
      { method: 'GET', path: '/portal/invoices', desc: 'My invoices', auth: false },
      { method: 'GET', path: '/portal/kb', desc: 'Knowledge base', auth: false },
    ],
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

export default function DocsPage() {
  const [search, setSearch] = useState('');
  const [sections, setSections] = useState<Record<string, boolean>>({});

  const filtered = ENDPOINTS.map(s => ({
    ...s,
    routes: s.routes.filter(r =>
      !search || r.path.toLowerCase().includes(search.toLowerCase()) || r.desc.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(s => s.routes.length > 0);

  const toggle = (section: string) => setSections(p => ({ ...p, [section]: !p[section] }));

  const totalEndpoints = ENDPOINTS.reduce((s, e) => s + e.routes.length, 0);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Book className="w-5 h-5" />API Reference</h1>
        <p className="text-sm text-muted-foreground">{totalEndpoints} endpoints across {ENDPOINTS.length} sections</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search endpoints..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-violet-500/20 text-sm"
        />
      </div>

      {filtered.map(section => (
        <div key={section.section} className="bg-card border border-border rounded-2xl overflow-hidden">
          <button onClick={() => toggle(section.section)}
            className="flex items-center justify-between w-full px-5 py-3.5 hover:bg-accent/50 transition-colors">
            <h2 className="font-semibold text-sm">{section.section}</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{section.routes.length} routes</span>
              <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform',
                sections[section.section] && 'rotate-180')} />
            </div>
          </button>
          {(sections[section.section] || search) && (
            <div className="border-t border-border divide-y divide-border">
              {section.routes.map(route => (
                <div key={route.path} className="px-5 py-3 hover:bg-accent/20 transition-colors">
                  <div className="flex items-center gap-3 mb-1">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', METHOD_COLORS[route.method])}>
                      {route.method}
                    </span>
                    <code className="text-xs font-mono text-foreground flex-1">{route.path}</code>
                    <button onClick={() => { navigator.clipboard.writeText(route.path); toast.success('Copied'); }}
                      className="p-1 rounded hover:bg-accent text-muted-foreground transition-colors">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground ml-14">{route.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
