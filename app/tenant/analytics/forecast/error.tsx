'use client';
import { RouteError } from '@/components/shared/route-error';

export default function Error(props: { error: Error; reset: () => void }) {
  return <RouteError {...props} />;
}
