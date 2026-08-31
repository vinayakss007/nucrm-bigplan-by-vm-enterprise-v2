/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, User, Clock, MessageSquare, Trash2, Send,
  Building2, Briefcase, Receipt, Mail, ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';

interface CustomerDeal {
  id: string;
  title: string;
  amount: string | null;
  stage_name: string | null;
  created_at: string;
}

interface CustomerInvoice {
  id: string;
  invoice_number: string;
  status: string;
  total_amount: string | null;
  currency: string | null;
  issue_date: string | null;
  due_date: string | null;
}

interface CustomerHistory {
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company_id: string | null;
  company_name: string | null;
  deals: CustomerDeal[];
  invoices: CustomerInvoice[];
}

interface TicketDetail {
  id: string;
  subject: string;
  body: string;
  status: string;
  priority: string;
  category: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  assigned_name: string | null;
  replies?: { id: string; body: string; created_at: string; author_name: string; is_internal: boolean }[];
  customer?: CustomerHistory;
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const ticketId = params['id'] as string;

  const loadTicket = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/tenant/tickets/${ticketId}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) { toast.error('Failed to load ticket'); router.push('/tenant/tickets'); return; }
      const d = await res.json();
      if (signal?.aborted) return;
      setTicket(d.data);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast.error('Failed to load');
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
    }
  }, [ticketId, router]);

  useEffect(() => {
    const controller = new AbortController();
    loadTicket(controller.signal);
    return () => controller.abort();
  }, [loadTicket]);

  const sendReply = async () => {
    if (!replyText.trim()) { toast.error('Reply cannot be empty'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/tenant/tickets/${params['id']}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyText }),
      });
      if (res.ok) { toast.success('Reply sent'); setReplyText(''); loadTicket(); }
      else toast.error('Failed to send');
    } catch { toast.error('Failed'); }
    setSending(false);
  };

  const updateStatus = async (status: string) => {
    const res = await fetch(`/api/tenant/tickets/${params['id']}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) { toast.success(`Status: ${status}`); loadTicket(); }
    else toast.error('Failed to update');
  };

  const deleteTicket = async () => {
    await confirmThen('Delete this ticket?', async () => {
      const res = await fetch(`/api/tenant/tickets/${params['id']}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Deleted'); router.push('/tenant/tickets'); }
      else toast.error('Failed to delete');
    });
  };

  if (loading) return (
    <div className="space-y-4 animate-fade-in">
      <div className="h-8 w-48 bg-muted rounded animate-pulse" />
      <div className="h-4 w-96 bg-muted rounded animate-pulse" />
      <div className="h-32 bg-muted rounded-xl animate-pulse" />
    </div>
  );

  if (!ticket) return null;

  const statusColor: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
  };

  const fmtMoney = (amount: string | null, currency: string | null) => {
    const n = Number(amount ?? 0);
    if (!Number.isFinite(n)) return String(amount ?? '');
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n);
    } catch {
      return `${currency || ''} ${n.toLocaleString()}`.trim();
    }
  };

  const invoiceStatusColor: Record<string, string> = {
    paid: 'text-emerald-600',
    overdue: 'text-red-600',
    draft: 'text-muted-foreground',
    sent: 'text-blue-600',
  };

  const customer = ticket.customer;
  const hasCustomer = !!(customer && (customer.contact_id || customer.company_id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in items-start">
      <div className="lg:col-span-2 space-y-6">
      {/* Back button + actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push('/tenant/tickets')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </button>
        <div className="flex items-center gap-2">
          {['open', 'in_progress', 'resolved', 'closed'].map(s => (
            <button key={s} onClick={() => updateStatus(s)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-lg border transition-all capitalize',
                ticket.status === s
                  ? 'bg-violet-600 border-violet-600 text-white'
                  : 'border-border text-muted-foreground hover:bg-accent'
              )}>
              {s.replace('_', ' ')}
            </button>
          ))}
          <button onClick={deleteTicket} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Ticket header */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full', statusColor[ticket.status])}>
            {ticket.status.replace('_', ' ')}
          </span>
          <span className={cn('text-[10px] font-bold uppercase tracking-wider', ticket.priority === 'urgent' ? 'text-red-600' : ticket.priority === 'high' ? 'text-orange-600' : 'text-muted-foreground')}>
            {ticket.priority}
          </span>
          <span className="text-xs text-muted-foreground">• {ticket.category}</span>
        </div>
        <h1 className="text-xl font-bold mb-4">{ticket.subject}</h1>
        {ticket.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-4">{ticket.body}</p>}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-4">
          <span className="flex items-center gap-1"><User className="w-3 h-3" />{ticket.first_name ? `${ticket.first_name} ${ticket.last_name || ''}` : 'System'}</span>
          <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{ticket.assigned_name ? `Assigned: ${ticket.assigned_name}` : 'Unassigned'}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(ticket.created_at)}</span>
        </div>
      </div>

      {/* Replies */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Replies</h2>
        </div>
        <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
          {(ticket.replies?.length || 0) === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No replies yet</div>
          ) : ticket.replies?.map((reply) => (
            <div key={reply.id} className={cn('p-4', reply.is_internal && 'bg-amber-50/50 dark:bg-amber-950/10')}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">{reply.author_name}{reply.is_internal && <span className="text-amber-600 ml-1">(Internal)</span>}</span>
                <span className="text-[10px] text-muted-foreground">{formatRelativeTime(reply.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Reply form */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
        <textarea
          value={replyText}
          onChange={e => setReplyText(e.target.value)}
          placeholder="Write a reply..."
          rows={3}
          required
          aria-required="true"
          className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none mb-3"
          onKeyDown={e => { if (e.metaKey && e.key === 'Enter') { e.preventDefault(); sendReply(); } }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">⌘Enter to send</span>
          <button onClick={sendReply} disabled={sending || !replyText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
            <Send className="w-3.5 h-3.5" />{sending ? 'Sending...' : 'Send Reply'}
          </button>
        </div>
      </div>
      </div>

      {/* Customer History panel (#1813) — surfaces the customer's company,
          deals and invoices so support has sales/billing context inline. */}
      <aside className="lg:col-span-1 space-y-4 lg:sticky lg:top-6">
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <User className="w-4 h-4" /> Customer History
            </h2>
          </div>

          {!hasCustomer ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              This ticket isn&apos;t linked to a contact or company.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Contact + company */}
              <div className="p-4 space-y-2">
                {customer?.contact_id && (
                  <Link href={`/tenant/contacts/${customer.contact_id}`}
                    className="flex items-center gap-2 text-sm hover:text-violet-600 transition-colors group">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{customer.contact_name || 'Contact'}</span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}
                {customer?.contact_email && (
                  <a href={`mailto:${customer.contact_email}`}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Mail className="w-3.5 h-3.5" />{customer.contact_email}
                  </a>
                )}
                {customer?.company_id && (
                  <Link href={`/tenant/companies/${customer.company_id}`}
                    className="flex items-center gap-2 text-sm hover:text-violet-600 transition-colors group">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{customer.company_name || 'Company'}</span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}
              </div>

              {/* Deals */}
              <div className="p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" /> Deals ({customer?.deals.length || 0})
                </h3>
                {(customer?.deals.length || 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No deals for this customer.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {customer?.deals.map((d) => (
                      <li key={d.id}>
                        <Link href={`/tenant/deals/${d.id}`}
                          className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-accent transition-colors group">
                          <span className="truncate">
                            <span className="font-medium">{d.title}</span>
                            {d.stage_name && <span className="text-muted-foreground"> · {d.stage_name}</span>}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{fmtMoney(d.amount, null)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Invoices */}
              <div className="p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5" /> Invoices ({customer?.invoices.length || 0})
                </h3>
                {(customer?.invoices.length || 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No invoices for this customer.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {customer?.invoices.map((inv) => (
                      <li key={inv.id}>
                        <Link href={`/tenant/invoices/${inv.id}`}
                          className="flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 hover:bg-accent transition-colors">
                          <span className="truncate">
                            <span className="font-medium">{inv.invoice_number}</span>
                            <span className={cn('ml-1.5 capitalize', invoiceStatusColor[inv.status] || 'text-muted-foreground')}>
                              · {inv.status}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{fmtMoney(inv.total_amount, inv.currency)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
