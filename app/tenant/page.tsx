import { redirect } from 'next/navigation';

export default function TenantIndexPage() {
  redirect('/tenant/dashboard');
}
