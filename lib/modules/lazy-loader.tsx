/**
 * Lazy Module Loader
 *
 * Combines next/dynamic with the module gate system so that:
 * 1. Heavy feature code is NEVER loaded unless the module is active for the tenant
 * 2. The JS bundle stays small — disabled modules don't add weight
 * 3. Proper loading skeletons are shown during dynamic import
 *
 * This is the key to keeping the app lightweight regardless of how many
 * features exist. A tenant on the free plan loads ZERO bytes of code for
 * enterprise-only modules.
 *
 * Usage:
 *   const WhatsAppPanel = lazyModule('whatsapp-bot', () => import('@/components/tenant/whatsapp-panel'));
 *   // In JSX:
 *   <WhatsAppPanel />  // Only loads if module is active, otherwise renders nothing
 */
'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { useHasModule } from './client-gate';

// ── Skeleton placeholder ─────────────────────────────────────────────────────

function ModuleLoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="h-4 bg-muted rounded w-1/3" />
      <div className="h-32 bg-muted rounded" />
    </div>
  );
}

function ModuleDisabledPlaceholder({ _moduleId }: { _moduleId: string }) {
  // Render nothing — the sidebar/nav should already hide the link
  return null;
}

// ── Lazy Module Factory ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComponentImport = () => Promise<{ default: React.ComponentType<any> }>;

/**
 * Create a lazily-loaded component that only loads its JS bundle when:
 * - The module is active for the current tenant
 * - The component is actually rendered
 *
 * If the module is disabled, the component renders nothing (or a custom fallback).
 *
 * @param moduleId - The module that must be active
 * @param importFn - Dynamic import function: () => import('./MyComponent')
 * @param options  - Optional configuration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyModule<P extends Record<string, any> = Record<string, never>>(
  moduleId: string,
  importFn: ComponentImport,
  options?: {
    /** Custom loading skeleton */
    loading?: React.ReactNode;
    /** Custom fallback when module is disabled */
    disabledFallback?: React.ReactNode;
    /** SSR enabled (default: false for client modules) */
    ssr?: boolean;
  }
): React.ComponentType<P> {
  // Create the dynamic component (code-split point)
  const DynamicComponent = dynamic(importFn, {
    loading: () => <>{options?.loading ?? <ModuleLoadingSkeleton />}</>,
    ssr: options?.ssr ?? false,
  });

  // Wrapper that checks module gate before rendering
  function GatedComponent(props: P) {
    const isActive = useHasModule(moduleId);

    if (!isActive) {
      return <>{options?.disabledFallback ?? <ModuleDisabledPlaceholder _moduleId={moduleId} />}</>;
    }

    return <DynamicComponent {...props} />;
  }

  GatedComponent.displayName = `LazyModule(${moduleId})`;
  return GatedComponent as React.ComponentType<P>;
}

// ── Pre-configured lazy modules for common heavy features ────────────────────

/**
 * These are the heaviest components in the app.
 * They are code-split and gated so tenants who don't use them
 * pay ZERO bundle cost.
 *
 * Import these instead of the raw component:
 *   import { LazyWorkflowBuilder } from '@/lib/modules/lazy-loader';
 */

export const LazyWorkflowBuilder = lazyModule(
  'automation-pro',
  () => import('@/components/tenant/automation/workflow-builder').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);

export const LazyEmailSequenceBuilder = lazyModule(
  'automation-pro',
  () => import('@/components/tenant/sequences/sequence-builder').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);

export const LazyFormsBuilder = lazyModule(
  'forms-builder',
  () => import('@/components/tenant/forms/form-builder').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);

export const LazyAnalyticsPro = lazyModule(
  'analytics-pro',
  () => import('@/components/tenant/analytics/analytics-pro').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);

export const LazyWhatsAppPanel = lazyModule(
  'whatsapp-bot',
  () => import('@/components/tenant/integrations/whatsapp-panel').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);

export const LazyAIAssistant = lazyModule(
  'ai-assistant',
  () => import('@/components/tenant/ai/ai-assistant').catch(() => ({ default: () => null })),
  { loading: <ModuleLoadingSkeleton /> }
);
