import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function ProfileLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading profile settings" />
      <PageSkeleton />
    </>
  );
}
