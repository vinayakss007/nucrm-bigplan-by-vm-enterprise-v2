import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function NotificationsLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading notification settings" />
      <PageSkeleton />
    </>
  );
}
