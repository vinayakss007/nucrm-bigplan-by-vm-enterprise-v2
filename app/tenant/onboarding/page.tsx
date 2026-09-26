/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The post-signup onboarding wizard is gone. Signup already provisions the
 * workspace, default pipeline, deal stages and plan modules (see
 * lib/auth/api-handlers.ts) and writes `onboarding_complete`, so a new user
 * lands directly on /tenant/dashboard.
 *
 * This route survives only as a redirect target for old bookmarks, stale
 * "Skip setup" links and cached redirects. The previous 338-line wizard markup
 * lives in git history at b45de203~1 if it ever needs to be resurrected.
 */
export default function OnboardingPage() {
  redirect('/tenant/dashboard');
}
