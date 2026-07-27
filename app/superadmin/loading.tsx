import { ListSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function SuperadminLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading page" />
      <ListSkeleton />
    </>
  );
}
