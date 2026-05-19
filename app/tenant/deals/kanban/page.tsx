'use client';
import { useState, useEffect, useCallback } from 'react';
import { 
  DndContext, DragOverlay, closestCorners, KeyboardSensor, 
  PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent 
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Plus, GripVertical, X, MoreHorizontal, Calendar, DollarSign, 
  User, Clock, CheckCircle, AlertCircle, ChevronRight, TrendingUp, Building2
} from 'lucide-react';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Deal {
  id: string;
  title: string;
  amount: string | null;
  stageId: string | null;
  stageName?: string;
  closeDate: string | null;
  assignedTo: string | null;
  assignedName?: string;
  contactId: string | null;
  contactName?: string;
  companyName?: string;
  probability: number;
  createdAt: string;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  order: number;
}

const DEFAULT_STAGES: Stage[] = [
  { id: 'lead', name: 'Lead', color: 'bg-slate-400', order: 0 },
  { id: 'qualified', name: 'Qualified', color: 'bg-blue-400', order: 1 },
  { id: 'proposal', name: 'Proposal', color: 'bg-violet-400', order: 2 },
  { id: 'negotiation', name: 'Negotiation', color: 'bg-amber-400', order: 3 },
  { id: 'won', name: 'Won', color: 'bg-emerald-400', order: 4 },
  { id: 'lost', name: 'Lost', color: 'bg-red-400', order: 5 },
];

interface DealCardProps {
  deal: Deal;
  isDragging?: boolean;
}

function DealCard({ deal, isDragging }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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
          <p className="text-sm font-medium line-clamp-2">{deal.title}</p>
          {deal.contactName && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
              <User className="w-2.5 h-2.5" /> {deal.contactName}
            </p>
          )}
        </div>
      </div>
      
      <div className="flex items-center justify-between text-xs">
        {deal.amount && (
          <span className="font-semibold text-violet-600">{formatCurrency(parseFloat(deal.amount))}</span>
        )}
        {deal.closeDate && (
          <span className={cn('text-muted-foreground flex items-center gap-1', 
            new Date(deal.closeDate) < new Date() && 'text-red-500 font-medium'
          )}>
            <Clock className="w-3 h-3" />
            {formatRelativeTime(deal.closeDate)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
        {deal.probability > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${deal.probability}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{deal.probability}%</span>
          </div>
        )}
        {deal.assignedName && (
          <span className="text-[10px] text-muted-foreground">{deal.assignedName.split(' ')[0]}</span>
        )}
      </div>
    </div>
  );
}

function StageColumn({ stage, deals, onDealMove }: { stage: Stage; deals: Deal[]; onDealMove: (dealId: string, newStageId: string) => void }) {
  const total = deals.reduce((sum, d) => sum + (parseFloat(d.amount || '0') || 0), 0);

  return (
    <div className="flex-shrink-0 w-72">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', stage.color)} />
          <span className="text-sm font-semibold">{stage.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{deals.length}</span>
        </div>
      </div>
      
      <div className="space-y-2 min-h-[200px]">
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(deal => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </SortableContext>
        
        {deals.length === 0 && (
          <div className="h-32 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-xs">
            No deals
          </div>
        )}
      </div>

      <div className="mt-3 p-2 bg-muted/50 rounded-lg">
        <div className="text-xs text-muted-foreground">Total Value</div>
        <div className="text-lg font-bold">{formatCurrency(total)}</div>
      </div>
    </div>
  );
}

export default function DealsKanbanPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stages] = useState<Stage[]>(DEFAULT_STAGES);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/deals');
      const data = await res.json();
      setDeals(data.deals || []);
    } catch (error) {
      console.error('Failed to fetch deals', error);
      toast.error('Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeDeal = deals.find(d => d.id === active.id);
    if (!activeDeal) return;

    let newStageId = over.id as string;
    
    if (over.id.toString().startsWith('stage-')) {
      newStageId = over.id.toString().replace('stage-', '');
    } else {
      const overDeal = deals.find(d => d.id === over.id);
      if (overDeal) {
        newStageId = overDeal.stageId || stages[0]?.id || '';
      }
    }

    if (activeDeal.stageId !== newStageId) {
      try {
        const res = await fetch(`/api/tenant/deals/${activeDeal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageId: newStageId }),
        });
        
        if (res.ok) {
          setDeals(prev => prev.map(d => d.id === activeDeal.id ? { ...d, stageId: newStageId } : d));
          toast.success(`Deal moved to ${stages.find(s => s.id === newStageId)?.name}`);
        }
      } catch (error) {
        toast.error('Failed to move deal');
      }
    }
  };

  const getDealsByStage = (stageId: string) => deals.filter(d => d.stageId === stageId);
  const totalValue = deals.reduce((sum, d) => sum + (parseFloat(d.amount || '0') || 0), 0);
  const wonDeals = deals.filter(d => d.stageId === 'won');
  const wonValue = wonDeals.reduce((sum, d) => sum + (parseFloat(d.amount || '0') || 0), 0);

  const activeDeal = activeId ? deals.find(d => d.id === activeId) : null;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-violet-600" />
            Deal Pipeline
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Drag deals between stages to update status</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-lg overflow-hidden text-xs">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn('px-3 py-1.5', viewMode === 'kanban' ? 'bg-violet-600 text-white' : 'bg-card hover:bg-accent')}
            >
              Kanban
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('px-3 py-1.5', viewMode === 'list' ? 'bg-violet-600 text-white' : 'bg-card hover:bg-accent')}
            >
              List
            </button>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-xs sm:text-sm shrink-0">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Deal</span><span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Deals', value: deals.length },
          { label: 'Pipeline Value', value: formatCurrency(totalValue), color: 'text-violet-600' },
          { label: 'Won Deals', value: wonDeals.length, color: 'text-emerald-600' },
          { label: 'Won Value', value: formatCurrency(wonValue), color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="admin-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-lg sm:text-xl font-bold', (s as any).color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-6 h-6 border-2 border-violet-600 border-t-transparent rounded-full" />
        </div>
      ) : viewMode === 'list' ? (
        /* List view for mobile */
        <div className="space-y-4">
          {stages.map(stage => {
            const stageDeals = getDealsByStage(stage.id);
            if (!stageDeals.length) return null;
            const total = stageDeals.reduce((sum, d) => sum + (parseFloat(d.amount || '0') || 0), 0);
            return (
              <div key={stage.id} className="admin-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
                  <div className={cn('w-3 h-3 rounded-full', stage.color)} />
                  <span className="text-sm font-semibold">{stage.name}</span>
                  <span className="text-xs text-muted-foreground">({stageDeals.length})</span>
                  <span className="ml-auto text-xs font-semibold text-violet-600">{formatCurrency(total)}</span>
                </div>
                <div className="divide-y divide-border">
                  {stageDeals.map(deal => (
                    <div key={deal.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{deal.title}</p>
                        {deal.contactName && <p className="text-xs text-muted-foreground">{deal.contactName}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        {deal.amount && <p className="text-sm font-semibold text-violet-600">{formatCurrency(parseFloat(deal.amount))}</p>}
                        {deal.closeDate && <p className={cn('text-xs', new Date(deal.closeDate) < new Date() ? 'text-red-500' : 'text-muted-foreground')}>{formatRelativeTime(deal.closeDate)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <DragOverlay>
            {activeDeal ? <DealCard deal={activeDeal} isDragging /> : null}
          </DragOverlay>

          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-0 sm:px-0 scrollbar-thin">
            {stages.map(stage => (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={getDealsByStage(stage.id)}
                onDealMove={(dealId, newStageId) => {
                  setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stageId: newStageId } : d));
                }}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
