/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { ListSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

/**
 * Segment-root fallback for the whole tenant app. Covers every tenant page that
 * does not define its own loading.tsx, which previously meant a blank screen on
 * navigation.
 */
export default function TenantLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading page" />
      <ListSkeleton />
    </>
  );
}
