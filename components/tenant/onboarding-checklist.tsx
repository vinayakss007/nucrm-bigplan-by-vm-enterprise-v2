'use client';
import { useState, useEffect } from 'react';
import { CheckCircle, Circle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const STEPS = [
  { id:'add_contact',     label:'Add your first contact',          href:'/tenant/contacts',           desc:'Import or create a contact to get started' },
  { id:'add_deal',        label:'Create your first deal',          href:'/tenant/deals',              desc:'Track your first sales opportunity' },
  { id:'invite_team',     label:'Invite a team member',            href:'/tenant/settings/team',      desc:'Collaborate with your team' },
  { id:'setup_workspace', label:'Customise your workspace',        href:'/tenant/settings/general',   desc:'Add your brand colour and company info' },
  { id:'add_task',        label:'Create a task',                   href:'/tenant/tasks',              desc:'Stay on top of follow-ups' },
];

export default function OnboardingChecklist() {
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/tenant/onboarding').then(r => r.json()).then(d => {
      setSteps(d.steps_done ?? []);
      setDismissed(d.completed ?? false);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const complete = (stepId: string) => {
    const newSteps = [...new Set([...steps, stepId])];
    setSteps(newSteps);
    fetch('/api/tenant/onboarding', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: stepId }),
    });
  };

  const dismiss = () => {
    setDismissed(true);
    fetch('/api/tenant/onboarding', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true }),
    });
  };

  if (loading || dismissed) return null;

  const done = STEPS.filter(s => steps.includes(s.id)).length;
  const pct = Math.round((done / STEPS.length) * 100);
  const allDone = done === STEPS.length;

  if (allDone) return (
    <div className="admin-card p-4 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 mb-6">
      <div className="flex items-center gap-3">
        <CheckCircle className="w-6 h-6 text-emerald-600 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-emerald-700 dark:text-emerald-400">You're all set! 🎉</p>
          <p className="text-xs text-emerald-600/70">Your workspace is fully configured. Time to close some deals.</p>
        </div>
        <button onClick={dismiss} className="text-emerald-600/50 hover:text-emerald-600 transition-colors"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );

  return (
    <div className="admin-card mb-6 overflow-hidden">
      <div className="flex items-center gap-3 p-4 cursor-pointer select-none" onClick={() => setOpen(o => !o)}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold">Get started with NuCRM</p>
            <span className="text-xs bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full font-medium">{done}/{STEPS.length}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); dismiss(); }} className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors" title="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {STEPS.map(step => {
            const done = steps.includes(step.id);
            return (
              <div key={step.id} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors cursor-pointer', done && 'opacity-60')}
                onClick={() => { if (!done) complete(step.id); router.push(step.href); }}>
                {done
                  ? <CheckCircle className="w-5 h-5 text-violet-600 shrink-0" />
                  : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', done && 'line-through text-muted-foreground')}>{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>
                {!done && <span className="text-xs text-violet-600 shrink-0 font-medium">Start →</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
