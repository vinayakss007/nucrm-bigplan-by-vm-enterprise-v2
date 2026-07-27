import { CenteredSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

/**
 * Root-segment fallback.
 *
 * Catches the standalone top-level pages — landing, setup, docs, health, offline,
 * public form/offer/CSAT links — that sit outside the tenant, auth, portal and
 * superadmin subtrees. Those subtrees define their own loading.tsx, which takes
 * precedence, so this only ever renders for pages that would otherwise have no
 * Suspense boundary at all.
 */
export default function RootLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading" />
      <CenteredSkeleton />
    </>
  );
}
