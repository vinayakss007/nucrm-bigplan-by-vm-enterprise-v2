/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
