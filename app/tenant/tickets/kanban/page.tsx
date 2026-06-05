'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor,
  PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, ArrowLeft, LifeBuoy, User, Clock, AlertCircle
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import Link from 'next/link';

interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  assigned_name: string | null;
}

interface Column {
  id: string;
  name: string;
  color: string;
}

const COLUMNS: Column[] = [
  { id: 'open', name: 'Open', color: 'bg-slate-400' },
  { id: 'in_progress', name: 'In Progress', color: 'bg-blue-400' },
  { id: 'resolved', name: 'Resolved', color: 'bg-emerald-400' },
  { id: 'closed', name: 'Closed', color: 'bg-gray-400' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

function TicketCard({ ticket, isDragging }: { ticket: Ticket; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: ticket.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const contactName = [ticket.first_name, ticket.last_name].filter(Boolean).join(' ') || null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'admin-card p-3 cursor-grab active:cursor-grabbing group hover:border-violet-300 transition-all',
        isDragging && 'opacity-50 shadow-lg rotate-2'
      )}
    >
      <div className="flex items-start gap-2 mb-2">
        <button {...listeners} className="mt-0.5 p-0.5 -ml-1 text-muted-foreground touch-manipulation max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-grab" aria-label="Drag to reorder">
          <GripVertical className="w-3 h-3" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-2">{ticket.subject}</p>
          <span className={cn('inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full', PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS['low'])}>
            {ticket.priority}
          </span>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {contactName && (
          <p className="flex items-center gap-1">
            <User className="w-3 h-3" /> {contactName}
          </p>
        )}
        {ticket.assigned_name && (
          <p className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {ticket.assigned_name}
          </p>
        )}
        <p className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {formatRelativeTime(ticket.created_at)}
        </p>
      </div>
    </div>
  );
}

function TicketColumn({ column, tickets }: { column: Column; tickets: Ticket[] }) {
  return (
    <div className="flex-shrink-0 w-72">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', column.color)} />
          <span className="text-sm font-semibold">{column.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{tickets.length}</span>
        </div>
      </div>

      <div className="space-y-2 min-h-[200px]">
        <SortableContext items={tickets.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tickets.map(ticket => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </SortableContext>

        {tickets.length === 0 && (
          <div className="h-32 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-xs">
            No tickets
          </div>
        )}
      </div>
    </div>
  );
}

export default function TicketsKanbanPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/tickets');
      const data = await res.json();
      setTickets(data.data || []);
    } catch {
      toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeTicket = tickets.find(t => t.id === active.id);
    if (!activeTicket) return;

    let newStatus = over.id as string;

    // If dropped on another ticket, use that ticket's status
    const overTicket = tickets.find(t => t.id === over.id);
    if (overTicket) {
      newStatus = overTicket.status;
    }

    // Check if it's a valid column status
    const validStatuses = COLUMNS.map(c => c.id);
    if (!validStatuses.includes(newStatus)) return;

    if (activeTicket.status === newStatus) return;

    // Optimistic update
    setTickets(prev => prev.map(t => t.id === activeTicket.id ? { ...t, status: newStatus as Ticket['status'] } : t));

    try {
      const res = await fetch(`/api/tenant/tickets/${activeTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        toast.success(`Ticket moved to ${COLUMNS.find(c => c.id === newStatus)?.name}`);
      } else {
        // Revert
        setTickets(prev => prev.map(t => t.id === activeTicket.id ? { ...t, status: activeTicket.status } : t));
        toast.error('Failed to update ticket');
      }
    } catch {
      setTickets(prev => prev.map(t => t.id === activeTicket.id ? { ...t, status: activeTicket.status } : t));
      toast.error('Failed to update ticket');
    }
  };

  const getTicketsByStatus = (status: string) => tickets.filter(t => t.status === status);
  const activeTicket = activeId ? tickets.find(t => t.id === activeId) : null;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/tenant/tickets" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <LifeBuoy className="w-5 h-5 text-violet-600" />
              Ticket Board
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">Drag tickets between columns to update status</p>
        </div>
        <Link
          href="/tenant/tickets"
          className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg hover:bg-accent text-xs sm:text-sm font-medium"
        >
          List View
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {COLUMNS.map(col => (
          <div key={col.id} className="admin-card p-3">
            <div className="flex items-center gap-2">
              <div className={cn('w-3 h-3 rounded-full', col.color)} />
              <p className="text-xs text-muted-foreground">{col.name}</p>
            </div>
            <p className="text-lg font-bold mt-1">{getTicketsByStatus(col.id).length}</p>
          </div>
        ))}
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <DragOverlay>
            {activeTicket ? <TicketCard ticket={activeTicket} isDragging /> : null}
          </DragOverlay>

          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-0 sm:px-0 scrollbar-thin">
            {COLUMNS.map(column => (
              <TicketColumn
                key={column.id}
                column={column}
                tickets={getTicketsByStatus(column.id)}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
