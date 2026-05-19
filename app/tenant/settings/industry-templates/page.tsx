'use client';

import { useState } from 'react';
import { 
  Home, Laptop, Handshake, Check, ArrowRight, Loader2, 
  Sparkles, ShieldCheck, Zap, Layout
} from 'lucide-react';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

export default function IndustryTemplatesPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const templates = Object.values(INDUSTRY_TEMPLATES);

  const handleApply = async () => {
    if (!selectedId) return;
    
    setApplying(true);
    try {
      const res = await fetch('/api/tenant/industry-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedId }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply template');
      
      toast.success('Template applied successfully!');
      router.push('/tenant/dashboard');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  const getIcon = (icon: string) => {
    switch (icon) {
      case '🏠': return <Home className="w-6 h-6" />;
      case '💻': return <Laptop className="w-6 h-6" />;
      case '🤝': return <Handshake className="w-6 h-6" />;
      default: return <Sparkles className="w-6 h-6" />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3 h-3" /> Industry Templates
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">Setup your CRM in seconds</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Choose an industry template to pre-configure your fields, pipelines, and automations. 
          Eradicate "Blank Screen Syndrome" and start selling today.
        </p>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedId(template.id)}
            className={cn(
              "relative group text-left p-6 rounded-3xl border-2 transition-all duration-300",
              selectedId === template.id 
                ? "border-violet-600 bg-violet-50/50 dark:bg-violet-950/20 shadow-xl shadow-violet-500/10" 
                : "border-border bg-card hover:border-violet-400 hover:shadow-lg"
            )}
          >
            {selectedId === template.id && (
              <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-white">
                <Check className="w-4 h-4" />
              </div>
            )}
            
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors",
              selectedId === template.id ? "bg-violet-600 text-white" : "bg-muted group-hover:bg-violet-100 group-hover:text-violet-600"
            )}>
              {getIcon(template.icon)}
            </div>
            
            <h3 className="text-xl font-bold mb-2">{template.name}</h3>
            <p className="text-sm text-muted-foreground mb-6">{template.description}</p>
            
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Layout className="w-3.5 h-3.5" /> {template.custom_fields.length} Custom Fields
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Zap className="w-3.5 h-3.5" /> {template.automations.length} Automations
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" /> {template.pipelines.length} Pipelines
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Action Footer */}
      <div className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md px-4 transition-all duration-500",
        selectedId ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12 pointer-events-none"
      )}>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Selected</p>
            <p className="font-bold truncate">{templates.find(t => t.id === selectedId)?.name}</p>
          </div>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold transition-all disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Apply Setup
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <div className="h-24" /> {/* Spacer */}
    </div>
  );
}
