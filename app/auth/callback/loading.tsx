import { CenteredSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement label="Completing sign in" />
      <CenteredSkeleton />
    </>
  );
}
