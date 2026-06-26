/**
 * AI section nav config — single source of truth for the AI Hub layout.
 *
 * Each entry maps to a page under /tenant/ai/. Items can declare which
 * other CRM features they depend on (so the UI can warn if the dep is
 * missing or unconfigured).
 */
import {
  Sparkles, FileEdit, Target, AlertTriangle, Activity,
  BrainCircuit, MessageSquare,
} from 'lucide-react';

export type AICapability = {
  href: string;
  label: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  desc: string;
  /** CRM features this capability needs to actually work. */
  depends_on: string[];
  /** Pin to dashboard? */
  primary?: boolean;
  badge?: 'new' | 'beta' | 'soon';
  adminOnly?: boolean;
};

export const AI_CAPABILITIES: AICapability[] = [
  {
    href: '/tenant/ai',
    label: 'AI Hub',
    icon: Sparkles,
    desc: 'Overview · status · suggestions',
    depends_on: [],
    primary: true,
  },
  {
    href: '/tenant/ai/draft',
    label: 'Auto-Draft',
    icon: FileEdit,
    desc: 'Generate follow-up emails, calls, notes',
    depends_on: ['Email integration', 'Contacts'],
    badge: 'beta',
  },
  {
    href: '/tenant/ai/lead-scoring',
    label: 'Lead Scoring',
    icon: Target,
    desc: 'Predict who to call next',
    depends_on: ['Leads', 'Activity history', 'Picklists (sources)'],
    badge: 'beta',
  },
  {
    href: '/tenant/ai/at-risk',
    label: 'At-Risk Deals',
    icon: AlertTriangle,
    desc: 'Stalled deals worth a manager nudge',
    depends_on: ['Deals', 'Pipeline stages', 'Activities'],
    badge: 'beta',
  },
  {
    href: '/tenant/ai/summarize',
    label: 'Summarize',
    icon: MessageSquare,
    desc: 'TL;DR for any record',
    depends_on: ['Activities', 'Notes'],
  },
  {
    href: '/tenant/ai/activity',
    label: 'Activity Log',
    icon: Activity,
    desc: 'What AI did recently · tokens · cost',
    depends_on: [],
  },
  {
    href: '/tenant/settings/ai-providers',
    label: 'Providers',
    icon: BrainCircuit,
    desc: 'Any LLM · OpenAI-compatible · Ollama · custom',
    depends_on: [],
    adminOnly: true,
  },
];

/** Preset provider defaults. Any provider not in this list is "custom" — users add them freely. */
export const AI_PROVIDER_PRESETS: Record<string, { label: string; defaultModel: string; site: string; note: string; base_url?: string }> = {
  openai:    { label: 'OpenAI',    defaultModel: 'gpt-4o-mini',              site: 'platform.openai.com',  note: 'Best general-purpose; fastest cost-quality balance with -mini.' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', site: 'console.anthropic.com', note: 'Strong reasoning; longer context for summaries.' },
  groq:      { label: 'Groq',      defaultModel: 'llama-3.1-70b-versatile',  site: 'console.groq.com',     note: 'Ultra-fast Llama inference; great for live drafts.' },
  ollama:    { label: 'Ollama',    defaultModel: 'llama3.1:8b',              site: 'ollama.com',           note: 'Self-hosted; data never leaves your machine.', base_url: 'http://localhost:11434' },
  opencode:  { label: 'OpenCode',  defaultModel: 'deepseek-v4-flash-free',   site: 'opencode.ai',          note: 'Platform-provided AI; 48+ models including free tiers. Bring your own key.', base_url: 'https://opencode.ai/zen' },
};

/**
 * Generate a display label for any provider (named or custom).
 */
export function getProviderLabel(id: string): string {
  return AI_PROVIDER_PRESETS[id]?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}
