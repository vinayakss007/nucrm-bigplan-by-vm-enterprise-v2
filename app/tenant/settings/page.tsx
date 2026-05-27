import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';

// Settings index — redirects to profile for a sensible default landing.
export default function SettingsIndex() {
  redirect('/tenant/settings/profile');
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
      <Settings className="w-4 h-4" />
      <Link href="/tenant/settings/profile" className="text-violet-600 hover:underline">
        Open My Profile
      </Link>
    </div>
  );
}
