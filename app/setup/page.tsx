/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { redirect } from 'next/navigation';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, count } from 'drizzle-orm';
import SetupClient from './SetupClient';

export const dynamic = 'force-dynamic';

async function checkSetupDone(): Promise<boolean> {
  try {
    const [row] = await db.select({ count: count() }).from(users).where(eq(users.isSuperAdmin, true));
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

export default async function SetupPage() {
  const setupDone = await checkSetupDone();
  
  if (setupDone) {
    redirect('/auth/login?already=true');
  }
  
  return <SetupClient />;
}