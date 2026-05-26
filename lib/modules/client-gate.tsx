/**
 * Client-Side Module Gate
 *
 * Provides React context + hooks so components can:
 * 1. Check if a module/feature is enabled without hitting the server every render
 * 2. Conditionally render UI based on enabled modules
 * 3. Lazy-load heavy modules only when they're enabled for the tenant
 *
 * The tenant's module list is fetched ONCE on mount and cached in context.
 * Sidebar, pages, and feature sections all consume this to hide/show content.
 *
 * Usage:
 *   const { hasModule, hasFeature, modules } = useModules();
 *   if (hasModule('whatsapp-bot')) { ... }
 */
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModuleInfo {
  id: string;
  name: string;
  status: 'active' | 'disabled' | 'available';
  category: string;
  icon: string;
  features?: string[];
  enabledFeatures?: string[];
}

interface ModuleContextValue {
  /** All modules with their status for this tenant */
  modules: ModuleInfo[];
  /** Check if a module is active */
  hasModule: (moduleId: string) => boolean;
  /** Check if a specific feature within a module is enabled */
  hasFeature: (moduleId: string, featureKey: string) => boolean;
  /** Whether modules have been loaded */
  loaded: boolean;
  /** Refresh modules from server (call after enable/disable) */
  refresh: () => Promise<void>;
}

const ModuleContext = createContext<ModuleContextValue>({
  modules: [],
  hasModule: () => false,
  hasFeature: () => false,
  loaded: false,
  refresh: async () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

interface ModuleProviderProps {
  children: React.ReactNode;
  /** Pre-loaded modules from server component (avoids client fetch on first load) */
  initialModules?: ModuleInfo[];
}

export function ModuleProvider({ children, initialModules }: ModuleProviderProps) {
  const [modules, setModules] = useState<ModuleInfo[]>(initialModules ?? []);
  const [loaded, setLoaded] = useState(!!initialModules);

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/modules', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      const data: ModuleInfo[] = (json.data ?? []).map((m: any) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        category: m.category,
        icon: m.icon,
        features: m.features ?? [],
        enabledFeatures: m.enabledFeatures ?? [],
      }));
      setModules(data);
      setLoaded(true);
    } catch (err) {
      console.error('[ModuleProvider] Failed to load modules:', err);
    }
  }, []);

  useEffect(() => {
    if (!initialModules) {
      fetchModules();
    }
  }, [fetchModules, initialModules]);

  // Build a Set for O(1) lookup
  const activeSet = useMemo(
    () => new Set(modules.filter(m => m.status === 'active').map(m => m.id)),
    [modules]
  );

  const hasModule = useCallback(
    (moduleId: string) => activeSet.has(moduleId),
    [activeSet]
  );

  const hasFeature = useCallback(
    (moduleId: string, featureKey: string) => {
      const mod = modules.find(m => m.id === moduleId);
      if (!mod || mod.status !== 'active') return false;
      const enabled = mod.enabledFeatures ?? [];
      // Empty means all features enabled
      if (enabled.length === 0) return true;
      return enabled.includes(featureKey);
    },
    [modules]
  );

  const value = useMemo(
    () => ({ modules, hasModule, hasFeature, loaded, refresh: fetchModules }),
    [modules, hasModule, hasFeature, loaded, fetchModules]
  );

  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Access the module gate from any client component */
export function useModules() {
  return useContext(ModuleContext);
}

/** Convenience: returns true if module is active */
export function useHasModule(moduleId: string): boolean {
  const { hasModule, loaded } = useModules();
  return loaded && hasModule(moduleId);
}

// ── Gate Component ───────────────────────────────────────────────────────────

interface ModuleGateProps {
  /** Module ID that must be active */
  moduleId: string;
  /** Optional feature key within the module */
  featureKey?: string;
  /** Rendered when module is active */
  children: React.ReactNode;
  /** Rendered when module is NOT active (optional — defaults to nothing) */
  fallback?: React.ReactNode;
}

/**
 * Conditionally render children only if the module (and optionally feature) is enabled.
 * When disabled, renders nothing or the fallback.
 *
 * Example:
 *   <ModuleGate moduleId="whatsapp-bot">
 *     <WhatsAppPanel />
 *   </ModuleGate>
 */
export function ModuleGate({ moduleId, featureKey, children, fallback = null }: ModuleGateProps) {
  const { hasModule, hasFeature, loaded } = useModules();

  if (!loaded) return null; // Don't flash content while loading

  if (featureKey) {
    return hasFeature(moduleId, featureKey) ? <>{children}</> : <>{fallback}</>;
  }

  return hasModule(moduleId) ? <>{children}</> : <>{fallback}</>;
}
