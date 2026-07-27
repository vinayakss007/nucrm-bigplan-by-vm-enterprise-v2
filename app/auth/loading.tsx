import { CenteredSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function AuthLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading" />
      <CenteredSkeleton />
    </>
  );
}
