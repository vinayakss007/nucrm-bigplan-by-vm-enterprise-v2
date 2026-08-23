/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function NotificationsLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading notification settings" />
      <PageSkeleton />
    </>
  );
}
