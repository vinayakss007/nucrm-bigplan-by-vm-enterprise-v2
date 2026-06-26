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
    desc: 'OpenAI · Anthropic · Groq · Ollama · OpenCode',
    depends_on: [],
    adminOnly: true,
  },
];

export type AIProviderId = 'openai' | 'anthropic' | 'groq' | 'ollama' | 'opencode';

export const AI_PROVIDERS: { id: AIProviderId; label: string; defaultModel: string; site: string; note: string }[] = [
  { id: 'openai',    label: 'OpenAI',    defaultModel: 'gpt-4o-mini',          site: 'platform.openai.com',  note: 'Best general-purpose; fastest cost-quality balance with -mini.' },
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-3-5-sonnet',    site: 'console.anthropic.com', note: 'Strong reasoning; longer context for summaries.' },
  { id: 'groq',      label: 'Groq',      defaultModel: 'llama-3.1-70b-versatile', site: 'console.groq.com',  note: 'Ultra-fast Llama inference; great for live drafts.' },
  { id: 'ollama',    label: 'Ollama',    defaultModel: 'llama3.1:8b',           site: 'ollama.com',           note: 'Self-hosted; data never leaves your machine.' },
  { id: 'opencode',  label: 'OpenCode',  defaultModel: 'opencode',              site: 'opencode.ai',          note: 'Platform-provided AI; use your own key or leverage system credits.' },
];
