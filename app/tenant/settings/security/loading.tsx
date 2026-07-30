import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function SecurityLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading security settings" />
      <PageSkeleton />
    </>
  );
}
