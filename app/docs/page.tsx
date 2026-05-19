import { Metadata } from 'next';
import { Suspense } from 'react';
import DocsClient from '@/components/tenant/docs-client';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Documentation - NuCRM SaaS',
  description: 'Search and browse comprehensive NuCRM documentation',
};

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-10 w-96" />
      </div>
      <div className="grid grid-cols-4 gap-6">
        <Skeleton className="h-96 col-span-1" />
        <Skeleton className="h-96 col-span-3" />
      </div>
    </div>
  );
}

export default async function DocsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <DocsClient />
    </Suspense>
  );
}
