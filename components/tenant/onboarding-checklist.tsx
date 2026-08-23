/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle, Circle, Users, TrendingUp, Zap, Mail, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: typeof Users;
  check: () => Promise<boolean>;
}

const STEPS: Omit<Step, 'check'>[] = [
  { id: 'contact', label: 'Add your first contact', description: 'Import or create a contact to start', href: '/tenant/contacts', icon: Users },
  { id: 'deal', label: 'Create a deal', description: 'Track a sales opportunity', href: '/tenant/deals', icon: TrendingUp },
  { id: 'email', label: 'Connect email', description: 'Set up email integration', href: '/tenant/settings/integrations', icon: Mail },
  { id: 'automation', label: 'Set up an automation', description: 'Automate repetitive tasks', href: '/tenant/automation', icon: Zap },
  { id: 'team', label: 'Invite a team member', description: 'Collaborate with your team', href: '/tenant/settings/team', icon: Settings },
];

/**
 * Onboarding checklist widget for the dashboard.
 * Shows first-use progress for new tenants.
 * Disappears once all steps are completed.
 */
export default function OnboardingChecklist() {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function checkProgress() {
      try {
        const res = await fetch('/api/tenant/onboarding/progress');
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        const done = new Set<string>(data.completed || []);
        setCompleted(done);
        // Auto-dismiss if all done
        if (done.size >= STEPS.length) setDismissed(true);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    // Check if user previously dismissed
    if (typeof window !== 'undefined' && localStorage.getItem('nucrm_onboarding_dismissed') === '1') {
      setDismissed(true);
      setLoading(false);
      return;
    }
    checkProgress();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nucrm_onboarding_dismissed', '1');
    }
  };

  if (loading || dismissed) return null;

  const progress = Math.round((completed.size / STEPS.length) * 100);

  return (
    <div className="admin-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold">Getting Started</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{completed.size}/{STEPS.length} steps completed</p>
        </div>
        <button onClick={handleDismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Dismiss
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-violet-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {STEPS.map(step => {
          const done = completed.has(step.id);
          const Icon = step.icon;
          return (
            <Link
              key={step.id}
              href={step.href}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-all',
                done
                  ? 'border-green-200 dark:border-green-900/30 bg-green-50/50 dark:bg-green-950/10'
                  : 'border-border hover:border-violet-200 dark:hover:border-violet-800 hover:bg-muted/30'
              )}
            >
              {done ? (
                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-medium', done && 'line-through text-muted-foreground')}>{step.label}</p>
                <p className="text-xs text-muted-foreground truncate">{step.description}</p>
              </div>
              <Icon className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
