import { ListSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

/**
 * Segment-root fallback for the whole tenant app. Covers every tenant page that
 * does not define its own loading.tsx, which previously meant a blank screen on
 * navigation.
 */
export default function TenantLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading page" />
      <ListSkeleton />
    </>
  );
}
