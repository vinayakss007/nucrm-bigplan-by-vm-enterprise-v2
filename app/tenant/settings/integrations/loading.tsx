import { PageSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function IntegrationsLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading integrations settings" />
      <PageSkeleton />
    </>
  );
}
