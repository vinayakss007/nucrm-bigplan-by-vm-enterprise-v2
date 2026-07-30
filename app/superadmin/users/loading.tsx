import { ListSkeleton, LoadingAnnouncement } from '@/components/shared/page-skeleton';

export default function UsersLoading() {
  return (
    <>
      <LoadingAnnouncement label="Loading users" />
      <ListSkeleton />
    </>
  );
}
