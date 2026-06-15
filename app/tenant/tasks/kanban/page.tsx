'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor,
  PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, ArrowLeft, CheckSquare, User, Calendar, LinkIcon
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  due_date: string | null;
  assignedTo: string | null;
  assignee_name: string | null;
  contactId: string | null;
  firstName: string | null;
  lastName: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface Column {
  id: string;
  name: string;
  color: string;
}

const COLUMNS: Column[] = [
  { id: 'pending', name: 'Pending', color: 'bg-slate-400' },
  { id: 'in_progress', name: 'In Progress', color: 'bg-blue-400' },
  { id: 'completed', name: 'Completed', color: 'bg-emerald-400' },
  { id: 'cancelled', name: 'Cancelled', color: 'bg-red-400' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

function TaskCard({ task, isDragging }: { task: Task; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dueDate = task.dueDate || task.due_date;
  const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;
  const contactName = [task.firstName || task.first_name, task.lastName || task.last_name].filter(Boolean).join(' ') || null;
  const assigneeName = task.assignee_name || null;

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
          <p className="text-sm font-medium line-clamp-2">{task.title}</p>
          <span className={cn('inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full', PRIORITY_COLORS[task.priority] || PRIORITY_COLORS['medium'])}>
            {task.priority}
          </span>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {dueDate && (
          <p className={cn('flex items-center gap-1', isOverdue && task.status !== 'completed' && 'text-red-500 font-medium')}>
            <Calendar className="w-3 h-3" /> {formatRelativeTime(dueDate)}
          </p>
        )}
        {assigneeName && (
          <p className="flex items-center gap-1">
            <User className="w-3 h-3" /> {assigneeName}
          </p>
        )}
        {contactName && (
          <p className="flex items-center gap-1">
            <LinkIcon className="w-3 h-3" /> {contactName}
          </p>
        )}
      </div>
    </div>
  );
}

function TaskColumn({ column, tasks }: { column: Column; tasks: Task[] }) {
  return (
    <div className="flex-shrink-0 w-72">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', column.color)} />
          <span className="text-sm font-semibold">{column.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{tasks.length}</span>
        </div>
      </div>

      <div className="space-y-2 min-h-[200px]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="h-32 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-xs">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

export default function TasksKanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/tasks');
      const data = await res.json();
      setTasks(data.data || []);
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeTask = tasks.find(t => t.id === active.id);
    if (!activeTask) return;

    let newStatus = over.id as string;

    // If dropped on another task, use that task's status
    const overTask = tasks.find(t => t.id === over.id);
    if (overTask) {
      newStatus = overTask.status;
    }

    // Check if it's a valid column status
    const validStatuses = COLUMNS.map(c => c.id);
    if (!validStatuses.includes(newStatus)) return;

    if (activeTask.status === newStatus) return;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status: newStatus } : t));

    try {
      const res = await fetch(`/api/tenant/tasks/${activeTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        toast.success(`Task moved to ${COLUMNS.find(c => c.id === newStatus)?.name}`);
      } else {
        // Revert
        setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status: activeTask.status } : t));
        toast.error('Failed to update task');
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === activeTask.id ? { ...t, status: activeTask.status } : t));
      toast.error('Failed to update task');
    }
  };

  const getTasksByStatus = (status: string) => tasks.filter(t => t.status === status);
  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/tenant/tasks" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-violet-600" />
              Task Board
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">Drag tasks between columns to update status</p>
        </div>
        <Link
          href="/tenant/tasks"
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
            <p className="text-lg font-bold mt-1">{getTasksByStatus(col.id).length}</p>
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
            {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
          </DragOverlay>

          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-0 sm:px-0 scrollbar-thin">
            {COLUMNS.map(column => (
              <TaskColumn
                key={column.id}
                column={column}
                tasks={getTasksByStatus(column.id)}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
