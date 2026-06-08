'use client';
import { useState } from 'react';
import {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
  CheckCircle, ArrowRight, ArrowLeft, Rocket, Package, Building2, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRODUCT_REGISTRY } from '@/lib/products/registry';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { useRouter } from 'next/navigation';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, Brain, MessageCircle, LifeBuoy, Users, Home, ShoppingCart, Receipt,
};

function getIcon(name: string) {
  return ICON_MAP[name] ?? Package;
}

const STEPS = ['Choose Product', 'Confirm Modules', 'Quick Setup', 'Complete'] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [pipelineName, setPipelineName] = useState('');

  const products = Object.values(PRODUCT_REGISTRY);
  const selected = selectedProduct ? PRODUCT_REGISTRY[selectedProduct] : null;
  const template = selected ? INDUSTRY_TEMPLATES[selected.templateId] : null;

  const handleSelectProduct = (id: string) => {
    setSelectedProduct(id);
    const prod = PRODUCT_REGISTRY[id];
    if (prod) {
      const tmpl = INDUSTRY_TEMPLATES[prod.templateId];
      if (tmpl) {
        setEnabledModules([...tmpl.modules]);
        const firstPipeline = tmpl.pipelines[0];
        if (firstPipeline) {
          setPipelineName(firstPipeline.name);
        }
      }
    }
  };

  const toggleModule = (mod: string) => {
    setEnabledModules(prev =>
      prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]
    );
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canProceed = () => {
    if (step === 0) return selectedProduct !== null;
    if (step === 1) return enabledModules.length > 0;
    if (step === 2) return companyName.trim().length > 0 && !isSubmitting;
    return true;
  };

  const submitOnboarding = async () => {
    if (!selectedProduct) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/tenant/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selected?.templateId ?? selectedProduct,
          modules: enabledModules,
          companyName: companyName.trim(),
          pipelineName: pipelineName.trim() || 'Sales Pipeline',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Provisioning failed' }));
        setSubmitError((data as { error?: string }).error ?? 'Provisioning failed');
        setIsSubmitting(false);
        return;
      }

      // Mark onboarding as complete so user won't be redirected back here
      await fetch('/api/tenant/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          modules: enabledModules,
          company_name: companyName.trim(),
          pipeline_name: pipelineName.trim() || 'Sales Pipeline',
        }),
      }).catch((err) => console.error('[onboarding] complete error:', err));

      setStep(3);
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const goNext = () => {
    if (step === 2) {
      void submitOnboarding();
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6 animate-fade-in">
      {/* Skip button */}
      <div className="flex justify-end">
        <button
          onClick={async () => {
            await fetch('/api/tenant/onboarding/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ product_id: 'skip', modules: [] }),
            }).catch((err) => console.error('[onboarding] skip error:', err));
            router.push('/tenant/dashboard');
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip setup →
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((label, idx) => (
          <div key={label} className="flex items-center gap-2">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all',
              idx < step ? 'bg-emerald-500 text-white' :
              idx === step ? 'bg-violet-600 text-white' :
              'bg-muted text-muted-foreground'
            )}>
              {idx < step ? <CheckCircle className="w-4 h-4" /> : idx + 1}
            </div>
            <span className={cn(
              'text-xs font-medium hidden sm:inline',
              idx === step ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {label}
            </span>
            {idx < STEPS.length - 1 && (
              <div className={cn(
                'w-8 h-0.5 rounded',
                idx < step ? 'bg-emerald-500' : 'bg-muted'
              )} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Choose Product */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">Choose Your Product</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Select the product that best fits your business. You still get full CRM access.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {products.map((prod) => {
              const Icon = getIcon(prod.icon);
              return (
                <button
                  key={prod.id}
                  onClick={() => handleSelectProduct(prod.id)}
                  className={cn(
                    'admin-card p-4 text-left transition-all hover:border-violet-300 dark:hover:border-violet-700/50',
                    selectedProduct === prod.id && 'border-violet-500 dark:border-violet-500 ring-2 ring-violet-500/20'
                  )}
                >
                  <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-violet-600" />
                  </div>
                  <p className="text-sm font-semibold">{prod.name}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{prod.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2: Confirm Modules */}
      {step === 1 && template && (
        <div className="space-y-4">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">Confirm Modules</h1>
            <p className="text-sm text-muted-foreground mt-1">
              These modules will be activated for your workspace. Toggle any you do not need.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {template.modules.map((mod) => {
              const isEnabled = enabledModules.includes(mod);
              return (
                <button
                  key={mod}
                  onClick={() => toggleModule(mod)}
                  className={cn(
                    'flex items-center gap-3 p-4 rounded-xl border transition-all text-left',
                    isEnabled
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20'
                      : 'border-border bg-muted/20 opacity-60'
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0',
                    isEnabled ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground/30'
                  )}>
                    {isEnabled && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{mod}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Quick Setup */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">Quick Setup</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure your workspace basics. You can change these later in settings.
            </p>
          </div>
          <div className="max-w-md mx-auto space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                <Building2 className="w-4 h-4 inline mr-1.5" />
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your company name"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                <GitBranch className="w-4 h-4 inline mr-1.5" />
                Primary Pipeline Name
              </label>
              <input
                type="text"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="e.g. Sales Pipeline"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
            </div>
            <div className="p-4 rounded-xl border border-border bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground mb-2">Import Contacts</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Package className="w-4 h-4" />
                <span>CSV import will be available after setup</span>
              </div>
            </div>
            {submitError && (
              <div className="p-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20 text-sm text-red-700 dark:text-red-300">
                {submitError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 3 && (
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center mx-auto">
            <Rocket className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold">You are all set!</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Your workspace is ready with {selected?.name}. Remember, you have access to the full CRM
            capabilities - this product is your curated starting point.
          </p>
          <button
            onClick={() => router.push('/tenant/dashboard')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors mt-4"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation buttons */}
      {step < 3 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <button
            onClick={goBack}
            disabled={step === 0}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
              step === 0
                ? 'opacity-0 pointer-events-none'
                : 'hover:bg-muted text-muted-foreground'
            )}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={goNext}
            disabled={!canProceed()}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 2 ? (isSubmitting ? 'Setting up...' : 'Complete Setup') : 'Next'} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
