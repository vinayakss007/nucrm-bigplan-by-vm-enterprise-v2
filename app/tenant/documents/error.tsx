/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { RouteError } from '@/components/shared/route-error';

export default function Error(props: { error: Error; reset: () => void }) {
  return <RouteError {...props} />;
}
