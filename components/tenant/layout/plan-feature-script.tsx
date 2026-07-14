'use client';

import { useEffect } from 'react';

interface PlanFeatureScriptProps {
  planFeatures: string;
  isSuperAdmin: boolean;
}

export default function PlanFeatureScript({ planFeatures, isSuperAdmin }: PlanFeatureScriptProps) {
  useEffect(() => {
    window.__NUCRM_PLAN_FEATURES__ = JSON.parse(planFeatures);
    window.__NUCRM_IS_SUPER_ADMIN__ = isSuperAdmin;
  }, [planFeatures, isSuperAdmin]);

  return null;
}
