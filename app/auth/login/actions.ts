/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use server';
import { redirect } from 'next/navigation';
import { logError } from '@/lib/errors-server';

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const baseUrl = process.env['APP_URL'] || process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
    // #3046: this self-call had no deadline — a hung DB pinned the server
    // action forever and every user retry stacked another hung handler.
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const body = await res.json().catch((err) => {
        void logError({ error: err, context: 'auth/login:parse-body' });
        return {};
      });
      return { error: body.error || `Login failed (${res.status})` };
    }

    const data = await res.json();
    if (data.ok) {
      redirect('/tenant/dashboard');
    } else {
      return { error: data.error || 'Login failed' };
    }
  } catch (err) {
    // #3046: AbortSignal.timeout aborts with a TimeoutError DOMException —
    // tell the user to retry instead of the generic connection-failure text.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { error: 'Login is taking too long — please try again' };
    }
    return { error: 'Unable to connect to authentication service' };
  }
}