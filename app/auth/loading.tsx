/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { CenteredSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function AuthLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading" />
      <CenteredSkeleton />
    </>
  );
}
