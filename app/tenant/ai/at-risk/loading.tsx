import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement label="Loading at-risk analysis" />
      <PageSkeleton />
    </>
  );
}
