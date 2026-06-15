'use client';
import { X, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BulkAction {
  label: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  variant?: 'default' | 'danger';
  onClick: () => void;
}

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: BulkAction[];
}

export function BulkActionBar({ selectedCount, onClear, actions }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-foreground text-background shadow-2xl border border-border">
        <div className="flex items-center gap-2 text-sm font-semibold mr-1">
          <CheckSquare className="w-4 h-4" />
          {selectedCount} selected
        </div>
        <div className="w-px h-6 bg-background/20" />
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              action.variant === 'danger'
                ? 'hover:bg-red-500/20 text-red-300 hover:text-red-200'
                : 'hover:bg-background/10'
            )}
          >
            <action.icon className="w-3.5 h-3.5" />
            {action.label}
          </button>
        ))}
        <div className="w-px h-6 bg-background/20" />
        <button onClick={onClear} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs hover:bg-background/10 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
