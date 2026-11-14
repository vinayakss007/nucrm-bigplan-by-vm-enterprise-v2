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

interface DocsMarkdownProps {
  content: string;
  className?: string;
}

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
    return node.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
  }
  if (Array.isArray(node)) {
    let cleaned = false;
    return node.map((child) => {
      if (!cleaned && ((typeof child === 'string' && child.trim().length > 0) || React.isValidElement(child))) {
        cleaned = true;
        return cleanAlertChildren(child);
      }
      return child;
    });
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

export function DocsMarkdown({ content, className }: DocsMarkdownProps) {
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
            const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
            return (
              <a
                href={href}
                className="text-violet-600 dark:text-violet-400 hover:underline font-medium inline-flex items-center gap-0.5"
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="w-3 h-3 inline-block ml-0.5 opacity-70" />}
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

            // Detect GitHub markdown alert syntax: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
            const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);

            if (alertMatch && alertMatch[1]) {
              const type = alertMatch[1].toUpperCase();
              const cleanContent = cleanAlertChildren(children);

              const defaultAlert = {
                variant: 'info' as const,
                icon: Info,
                title: 'Note',
              };

              const alertConfigs: Record<
                string,
                {
                  variant: 'info' | 'tip' | 'warning' | 'destructive';
                  icon: typeof Info;
                  title: string;
                }
              > = {
                NOTE: defaultAlert,
                TIP: { variant: 'tip', icon: Lightbulb, title: 'Tip' },
                IMPORTANT: { variant: 'warning', icon: AlertCircle, title: 'Important' },
                WARNING: { variant: 'warning', icon: AlertTriangle, title: 'Warning' },
                CAUTION: { variant: 'destructive', icon: ShieldAlert, title: 'Caution' },
              };

              const config = alertConfigs[type] ?? defaultAlert;
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
