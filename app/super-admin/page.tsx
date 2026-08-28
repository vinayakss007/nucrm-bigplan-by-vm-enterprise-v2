/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1132: `/super-admin` (hyphenated) was a stale, orphaned duplicate of the
 * canonical super-admin UI under `/superadmin`. It was not linked from any nav
 * and — unlike `/superadmin`, which is guarded by app/superadmin/layout.tsx —
 * had no super-admin auth guard on the page itself.
 *
 * Rather than keep a second, unguarded copy of the dashboard, this route now
 * permanently redirects to the canonical `/superadmin/dashboard` (which
 * enforces the super-admin check). Any old bookmark to `/super-admin` keeps
 * working.
 */
import { redirect } from 'next/navigation';

export default function SuperAdminRedirect() {
  redirect('/superadmin/dashboard');
}
