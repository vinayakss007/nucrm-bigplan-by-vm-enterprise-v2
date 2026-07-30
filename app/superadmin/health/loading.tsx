import { ListSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function HealthLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading health dashboard" />
      <ListSkeleton />
    </>
  );
}
