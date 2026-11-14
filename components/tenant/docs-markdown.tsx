/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Info,
  AlertTriangle,
  AlertCircle,
  Lightbulb,
  ShieldAlert,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

export interface DocsMarkdownProps {
  content: string;
  className?: string;
  onNavigate?: (slug: string) => void;
}

export interface ResolvedDocLink {
  href: string;
  isExternal: boolean;
  isAnchor: boolean;
  slug?: string;
}

const DOC_PATH_MAP: Record<string, string> = {
  // User Guide
  'user-guide/contacts-and-companies': 'users/contacts',
  'contacts-and-companies': 'users/contacts',
  'user-guide/deals-and-pipelines': 'users/deals',
  'deals-and-pipelines': 'users/deals',
  'user-guide/leads': 'users/leads',
  'leads': 'users/leads',
  'user-guide/tasks-and-activities': 'users/tasks',
  'tasks-and-activities': 'users/tasks',
  'user-guide/sales-documents': 'billing/invoices',
  'sales-documents': 'billing/invoices',
  'user-guide/support-and-kb': 'support/faq',
  'user-guide/communication': 'users/activities',
  'communication': 'users/activities',
  'user-guide/automation': 'automation/workflows',
  'automation': 'automation/workflows',
  'user-guide/reports-and-dashboards': 'reports/dashboard',
  'reports-and-dashboards': 'reports/dashboard',
  'user-guide/ai-features': 'marketing/lead-scoring',
  'ai-features': 'marketing/lead-scoring',
  'user-guide/README': 'QUICKSTART',
  'user-guide': 'QUICKSTART',

  // Admin Guide
  'admin-guide/team-and-roles': 'settings/team',
  'team-and-roles': 'settings/team',
  'roles': 'settings/roles',
  'admin-guide/billing-and-plans': 'billing/invoices',
  'billing-and-plans': 'billing/invoices',
  'admin-guide/branding-and-customization': 'settings/tenant',
  'branding-and-customization': 'settings/tenant',
  'admin-guide/integrations': 'integrations/whatsapp',
  'integrations': 'integrations/whatsapp',
  'admin-guide/security-settings': 'security/overview',
  'security-settings': 'security/overview',
  'admin-guide/README': 'users/tenant-basics',
  'admin-guide': 'users/tenant-basics',

  // Developer & API
  'developer/README': 'automation/api',
  'developer/rest-api': 'automation/api',
  'rest-api': 'automation/api',
  'developer/webhooks': 'automation/webhooks',
  'webhooks': 'automation/webhooks',
  'developer/sdk': 'automation/api',
  'sdk': 'automation/api',
  'developer/authentication': 'settings/api-keys',
  'authentication': 'settings/api-keys',
  'api-keys': 'settings/api-keys',
  'developer/embeds-and-forms': 'marketing/forms',
  'embeds-and-forms': 'marketing/forms',
  'developer': 'automation/api',

  // Support & General
  'faq': 'support/faq',
  'glossary': 'support/faq',
  'troubleshooting': 'support/troubleshooting',
  'error-codes': 'support/error-codes',
  'customer-portal': 'support/faq',
  'getting-started': 'QUICKSTART',
  'README': 'QUICKSTART',
  'README_FINAL': 'README_FINAL',

  // Platform & Deployment
  'admin/deployment': 'deployment/guide',
  'admin/security': 'security/overview',
  'admin/configuration': 'deployment/env',
  'admin/README': 'security/overview',
  'admin': 'security/overview',
  'API-TESTING-GUIDE': 'automation/api',
  'API_MIGRATION_v1_to_v2': 'automation/api',
  'TROUBLESHOOTING': 'support/troubleshooting',
};

export function resolveDocLink(rawHref: string | undefined): ResolvedDocLink {
  if (!rawHref) {
    return { href: '#', isExternal: false, isAnchor: false };
  }

  // External URLs
  if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
    return { href: rawHref, isExternal: true, isAnchor: false };
  }

  // Pure page anchors
  if (rawHref.startsWith('#')) {
    return { href: rawHref, isExternal: false, isAnchor: true };
  }

  // OpenAPI spec link
  if (rawHref.includes('openapi.yaml')) {
    return { href: '/api-docs', isExternal: false, isAnchor: false };
  }

  // Split path and hash
  const [pathPart, hashPart] = rawHref.split('#');
  const hashSuffix = hashPart ? `#${hashPart}` : '';

  // Clean relative prefix and .md extension
  const normalized = pathPart.replace(/^(\.\.?\/)+/, '').replace(/\.md$/, '');

  // Check map
  const mappedSlug = DOC_PATH_MAP[normalized] || (normalized.includes('/') ? normalized : undefined);
  if (mappedSlug) {
    return {
      href: `/docs/${mappedSlug}${hashSuffix}`,
      isExternal: false,
      isAnchor: false,
      slug: mappedSlug,
    };
  }

  // Absolute paths in app
  if (pathPart.startsWith('/')) {
    return { href: rawHref, isExternal: false, isAnchor: false };
  }

  // Default fallback
  return {
    href: `/docs/${normalized}${hashSuffix}`,
    isExternal: false,
    isAnchor: false,
    slug: normalized,
  };
}

const ALERT_REGEX = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|HINT|DANGER|SUCCESS)\]/i;
const INLINE_ALERT_REGEX = /^\s*\*{0,2}(Note|Warning|Caution|Important|Tip|Hint|Danger|Info):\*{0,2}\s*/i;

const ALERT_CONFIGS: Record<
  string,
  {
    variant: 'info' | 'tip' | 'warning' | 'destructive' | 'success';
    icon: typeof Info;
    title: string;
  }
> = {
  NOTE: { variant: 'info', icon: Info, title: 'Note' },
  INFO: { variant: 'info', icon: Info, title: 'Info' },
  TIP: { variant: 'tip', icon: Lightbulb, title: 'Tip' },
  HINT: { variant: 'tip', icon: Lightbulb, title: 'Hint' },
  IMPORTANT: { variant: 'warning', icon: AlertCircle, title: 'Important' },
  WARNING: { variant: 'warning', icon: AlertTriangle, title: 'Warning' },
  CAUTION: { variant: 'destructive', icon: ShieldAlert, title: 'Caution' },
  DANGER: { variant: 'destructive', icon: ShieldAlert, title: 'Danger' },
  SUCCESS: { variant: 'success', icon: Check, title: 'Success' },
};

/**
 * Extracts plain text from React nodes recursively to inspect alert markers.
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

/**
 * Strips alert tag like [!NOTE] or [!WARNING] from the start of children recursively.
 */
function cleanAlertChildren(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') {
    return node
      .replace(ALERT_REGEX, '')
      .replace(INLINE_ALERT_REGEX, '');
  }
  if (Array.isArray(node)) {
    let cleaned = false;
    const result: React.ReactNode[] = [];
    for (const child of node) {
      if (!cleaned && ((typeof child === 'string' && child.trim().length > 0) || React.isValidElement(child))) {
        cleaned = true;
        const cleanedChild = cleanAlertChildren(child);
        if (typeof cleanedChild === 'string') {
          if (cleanedChild.length > 0) result.push(cleanedChild);
        } else if (React.isValidElement(cleanedChild)) {
          const innerText = extractText(cleanedChild).trim();
          if (innerText.length > 0) {
            result.push(cleanedChild);
          }
        } else if (cleanedChild) {
          result.push(cleanedChild);
        }
      } else {
        result.push(child);
      }
    }
    return result;
  }
  if (React.isValidElement(node)) {
    const props = (node.props as { children?: React.ReactNode }) || {};
    return React.cloneElement(node, undefined, cleanAlertChildren(props.children));
  }
  return node;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Code copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-4 rounded-xl border border-border bg-muted/60 overflow-hidden font-mono text-xs">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-muted/80 text-[11px] text-muted-foreground select-none">
        <span className="font-semibold uppercase tracking-wider text-foreground/70">
          {(language || 'text').toUpperCase()}
        </span>
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500 font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-foreground leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DocsMarkdown({ content, className, onNavigate }: DocsMarkdownProps) {
  return (
    <div className={cn('docs-markdown prose-headings:scroll-m-20', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mt-6 mb-4" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground border-b border-border pb-2 mt-8 mb-4" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-lg md:text-xl font-semibold tracking-tight text-foreground mt-6 mb-3" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-base font-semibold tracking-tight text-foreground mt-4 mb-2" {...props}>
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p className="text-sm leading-relaxed text-foreground/90 my-3" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="my-3 ml-5 list-disc space-y-1 text-sm text-foreground/90" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-3 ml-5 list-decimal space-y-1 text-sm text-foreground/90" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {children}
            </li>
          ),
          hr: () => <hr className="my-6 border-border" />,
          table: ({ children, ...props }) => (
            <div className="my-4 w-full overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs md:text-sm border-collapse" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted/60 border-b border-border font-semibold text-foreground" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th className="px-4 py-2.5 text-left font-semibold" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-4 py-2 border-t border-border/50 text-foreground/80" {...props}>
              {children}
            </td>
          ),
          a: ({ href, children, ...props }) => {
            const link = resolveDocLink(href);
            return (
              <a
                href={link.href}
                className="text-violet-600 dark:text-violet-400 hover:underline font-medium inline-flex items-center gap-0.5"
                target={link.isExternal ? '_blank' : undefined}
                rel={link.isExternal ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  if (
                    link.slug &&
                    onNavigate &&
                    !e.defaultPrevented &&
                    e.button === 0 &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.altKey &&
                    !e.shiftKey
                  ) {
                    e.preventDefault();
                    onNavigate(link.slug);
                  }
                }}
                {...props}
              >
                {children}
                {link.isExternal && <ExternalLink className="w-3 h-3 inline-block ml-0.5 opacity-70" />}
              </a>
            );
          },
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className || '');
            const raw = String(children).replace(/\n$/, '');
            const isMultiLine = raw.includes('\n') || !!match;

            if (isMultiLine) {
              const lang = match?.[1] ?? '';
              return <CodeBlock language={lang} code={raw} />;
            }

            return (
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground font-medium border border-border/40">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => {
            const text = extractText(children).trim();

            const alertMatch = text.match(ALERT_REGEX);
            const inlineMatch = !alertMatch ? text.match(INLINE_ALERT_REGEX) : null;
            const matchedTag = alertMatch?.[1] || inlineMatch?.[1];

            if (matchedTag) {
              const type = matchedTag.toUpperCase();
              const cleanContent = cleanAlertChildren(children);
              const config = ALERT_CONFIGS[type] || ALERT_CONFIGS.NOTE;
              const Icon = config.icon;

              return (
                <Alert variant={config.variant} className="my-4">
                  <Icon className="w-4 h-4" />
                  <AlertTitle>{config.title}</AlertTitle>
                  <AlertDescription>{cleanContent}</AlertDescription>
                </Alert>
              );
            }

            // General callout styling for other blockquotes (e.g. > **Audience:**, > 👤 **Tenant admin**)
            return (
              <div className="my-4 border-l-4 border-violet-500/80 bg-violet-500/5 dark:bg-violet-950/20 px-4 py-3 rounded-r-xl text-sm text-foreground/90">
                {children}
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default DocsMarkdown;
