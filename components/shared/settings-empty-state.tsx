'use client';
import { type LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';

interface SettingsEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export default function SettingsEmptyState({ icon: Icon, title, description, action }: SettingsEmptyStateProps) {
  return (
    <div className="text-center py-12 border border-dashed border-border rounded-2xl">
      <Icon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto hover:bg-violet-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {action.label}
        </button>
      )}
    </div>
  );
}
