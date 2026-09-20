/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { redirect } from 'next/navigation';

// Onboarding wizard removed: signup already provisions the workspace,
// pipeline, and default modules. Any visit to /tenant/onboarding goes
// straight to the dashboard.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  redirect('/tenant/dashboard');
  return <>{children}</>;
}
