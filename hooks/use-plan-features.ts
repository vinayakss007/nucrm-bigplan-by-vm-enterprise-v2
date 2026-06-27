'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Client-side plan feature gate.
 *
 * Reads plan features injected by the server layout via
 * window.__NUCRM_PLAN_FEATURES__ (set in a <script> tag).
 *
 * Usage:
 *   const { hasFeature, features, loaded } = usePlanFeatures();
 *   if (hasFeature('ai_draft')) { ... }
 */

declare global {
  interface Window {
    __NUCRM_PLAN_FEATURES__?: string[];
    __NUCRM_IS_SUPER_ADMIN__?: boolean;
  }
}

interface PlanFeaturesValue {
  /** All features enabled for this tenant's plan */
  features: string[];
  /** Check if a specific feature is enabled */
  hasFeature: (featureKey: string) => boolean;
  /** Whether features have been loaded */
  loaded: boolean;
}

export function usePlanFeatures(): PlanFeaturesValue {
  const [features, setFeatures] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Read from injected global
    const feats = window.__NUCRM_PLAN_FEATURES__ ?? [];
    setFeatures(feats);
    setLoaded(true);
  }, []);

  const featureSet = useMemo(() => new Set(features), [features]);

  const hasFeature = useCallback(
    (featureKey: string) => {
      // Super admins see everything
      if (typeof window !== 'undefined' && window.__NUCRM_IS_SUPER_ADMIN__) return true;
      return featureSet.has(featureKey);
    },
    [featureSet],
  );

  return { features, hasFeature, loaded };
}

/**
 * Server-side helper: get plan features as a plain array.
 * Pass this to the client via window.__NUCRM_PLAN_FEATURES__.
 */
export function getPlanFeaturesFromContext(planFeatures: string[]): string[] {
  return planFeatures ?? [];
}
