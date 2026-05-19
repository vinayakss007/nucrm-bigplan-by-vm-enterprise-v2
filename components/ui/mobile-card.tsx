'use client';

import { cn } from '@/lib/utils';

interface MobileCardField {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  fullWidth?: boolean;
}

interface MobileCardProps {
  title: string;
  subtitle?: string;
  avatar?: React.ReactNode;
  badge?: React.ReactNode;
  fields: MobileCardField[];
  actions?: {
    label: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'danger' | 'success';
    onClick: () => void;
  }[];
  onClick?: () => void;
  className?: string;
}

export function MobileCard({ title, subtitle, avatar, badge, fields, actions, onClick, className }: MobileCardProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-4 active:bg-accent/50 transition-colors',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {avatar && <div className="shrink-0">{avatar}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>

      {/* Fields */}
      {fields.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50">
          {fields.map((field, index) => {
            const content = (
              <div className="flex items-center gap-2 min-w-0">
                {field.icon && <span className="text-muted-foreground shrink-0">{field.icon}</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{field.label}</p>
                  <p className="text-xs font-medium truncate">{field.value}</p>
                </div>
              </div>
            );

            return (
              <div key={index} className={field.fullWidth ? '' : ''}>
                {field.href ? (
                  <a href={field.href} onClick={(e) => { e.stopPropagation(); field.onClick?.(); }} className="block">
                    {content}
                  </a>
                ) : field.onClick ? (
                  <button onClick={(e) => { e.stopPropagation(); field.onClick?.(); }} className="w-full text-left">
                    {content}
                  </button>
                ) : (
                  content
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
          {actions.map((action, index) => (
            <button
              key={index}
              onClick={(e) => { e.stopPropagation(); action.onClick(); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-h-[44px]',
                action.variant === 'danger' && 'text-red-600 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40',
                action.variant === 'success' && 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40',
                !action.variant && 'text-muted-foreground bg-muted/50 hover:bg-muted'
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface MobileCardListProps {
  cards: MobileCardProps[];
  className?: string;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
}

export function MobileCardList({ cards, className, emptyMessage = 'No items', emptyIcon }: MobileCardListProps) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        {emptyIcon && <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">{emptyIcon}</div>}
        <p className="text-sm font-medium text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3 md:hidden', className)}>
      {cards.map((card, index) => (
        <MobileCard key={index} {...card} />
      ))}
    </div>
  );
}

export default MobileCard;
