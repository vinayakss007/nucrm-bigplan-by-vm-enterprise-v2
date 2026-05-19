'use client';
import Link from 'next/link';
import { LifeBuoy, FileText, Book, ArrowRight, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUICK_LINKS = [
  { href: '/portal/tickets', label: 'My Tickets', icon: LifeBuoy, desc: 'View and create support tickets', color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/20' },
  { href: '/portal/invoices', label: 'Invoices', icon: FileText, desc: 'View and pay invoices', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
  { href: '/portal/kb', label: 'Knowledge Base', icon: Book, desc: 'Browse help articles', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20' },
];

export default function PortalPage() {
  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-muted-foreground mt-1">Your self-service portal for tickets, invoices, and help articles.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {QUICK_LINKS.map(link => (
          <Link key={link.href} href={link.href}
            className="group bg-card border border-border rounded-2xl p-6 hover:border-violet-200 dark:hover:border-violet-800 transition-all hover:shadow-sm">
            <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center mb-4', link.bg)}>
              <link.icon className={cn('w-6 h-6', link.color)} />
            </div>
            <h3 className="font-semibold group-hover:text-violet-600 transition-colors">{link.label}</h3>
            <p className="text-sm text-muted-foreground mt-1">{link.desc}</p>
            <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-violet-600 group-hover:gap-2 transition-all">
              Open <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        ))}
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold mb-4">Need help?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Can't find what you're looking for? Create a support ticket and our team will get back to you.
        </p>
        <Link href="/portal/tickets"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors">
          <Ticket className="w-4 h-4" /> Create Ticket
        </Link>
      </div>
    </div>
  );
}
