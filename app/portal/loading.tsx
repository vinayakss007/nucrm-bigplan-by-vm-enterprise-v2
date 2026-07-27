import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function PortalLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading" />
      <PageSkeleton />
    </>
  );
}
