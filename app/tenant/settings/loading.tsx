import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function SettingsLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading settings" />
      <PageSkeleton />
    </>
  );
}
