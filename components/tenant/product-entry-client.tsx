'use client';
import { useState } from 'react';
import {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  LayoutDashboard, Target, Briefcase, Calendar, GitBranch, Copy, Send,
  UserPlus, Plus, Mail, BarChart, Radio, Filter, Upload, Heart, Rocket,
  Zap, DollarSign, Clock, CheckCircle, AlertTriangle, Shield, Eye, Award,
  Star, AlertCircle, CreditCard, Book, Ticket, TrendingUp, ArrowRight,
  ChevronRight, Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import type { ProductEntry } from '@/lib/products/registry';
import Link from 'next/link';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  LayoutDashboard, Target, Briefcase, Calendar, GitBranch, Copy, Send,
  UserPlus, Plus, Mail, BarChart, Radio, Filter, Upload, Heart, Rocket,
  Zap, DollarSign, Clock, CheckCircle, AlertTriangle, Shield, Eye, Award,
  Star, AlertCircle, CreditCard, Book, Ticket, TrendingUp, Package,
};

function getIcon(name: string) {
  return ICON_MAP[name] ?? Package;
}

interface ProductEntryClientProps {
  product: ProductEntry;
  tenantId: string;
  userId: string;
}

export default function ProductEntryClient({ product, tenantId, userId }: ProductEntryClientProps) {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const template = INDUSTRY_TEMPLATES[product.templateId];
  const pipeline = template?.pipelines?.find(p => p.name === product.mainPipeline) ?? template?.pipelines?.[0];

  const HeroIcon = getIcon(product.icon);

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl">
      {/* Hero section */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-100 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
          <HeroIcon className="w-7 h-7 text-violet-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">{product.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{product.description}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Full CRM access available - this is your focused starting point
          </p>
        </div>
      </div>

      {/* Quick stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {product.dashboardCards.map((card) => {
          const CardIcon = getIcon(card.icon);
          return (
            <div key={card.stat_key} className="admin-card p-5 hover:border-violet-300 dark:hover:border-violet-700/50 transition-all">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">{card.title}</p>
                <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center">
                  <CardIcon className="w-4 h-4 text-violet-600" />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight">--</p>
              <p className="text-xs text-muted-foreground mt-1">Loading data...</p>
            </div>
          );
        })}
      </div>

      {/* Pipeline stages visualization */}
      {pipeline && (
        <div className="admin-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">{pipeline.name}</h2>
            <Link
              href="/tenant/deals"
              className="text-xs text-violet-600 hover:underline flex items-center gap-1"
            >
              View Pipeline <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex gap-1">
            {pipeline.stages.map((stage, idx) => (
              <div
                key={stage}
                className={cn(
                  'flex-1 text-center py-3 px-2 rounded-lg border transition-all relative',
                  idx === 0
                    ? 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800'
                    : 'bg-muted/30 border-border hover:bg-muted/50'
                )}
              >
                <p className="text-xs font-medium truncate">{stage}</p>
                <p className="text-lg font-bold mt-1">0</p>
                {idx < pipeline.stages.length - 1 && (
                  <ChevronRight className="absolute right-[-10px] top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 z-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {product.quickActions.map((action) => {
            const ActionIcon = getIcon(action.icon);
            return (
              <button
                key={action.action}
                onClick={() => setActiveAction(action.action)}
                className={cn(
                  'admin-card p-4 flex items-center gap-3 hover:border-violet-300 dark:hover:border-violet-700/50 transition-all text-left',
                  activeAction === action.action && 'border-violet-400 dark:border-violet-600'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
                  <ActionIcon className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="text-xs text-muted-foreground">Click to get started</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Module status section */}
      {template && (
        <div className="admin-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Active Modules</h2>
            <span className="text-xs text-muted-foreground">{template.modules.length} modules included</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {template.modules.map((mod) => (
              <div
                key={mod}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50"
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">{mod}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Additional modules available in Settings. Your full CRM features remain accessible.
          </p>
        </div>
      )}

      {/* Sidebar navigation links */}
      <div className="admin-card p-5">
        <h2 className="text-sm font-semibold mb-3">Navigation</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {product.sidebarItems.map((item) => {
            const ItemIcon = getIcon(item.icon);
            return (
              <Link
                key={item.href}
                href={`/tenant${item.href}`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
              >
                <ItemIcon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
