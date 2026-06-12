'use server';
import { redirect } from 'next/navigation';

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const baseUrl = process.env['APP_URL'] || process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const body = await res.json().catch(e => { console.error('[json] parse error:', e); return {}; });
      return { error: body.error || `Login failed (${res.status})` };
    }

    const data = await res.json();
    if (data.ok) {
      redirect('/tenant/dashboard');
    } else {
      return { error: data.error || 'Login failed' };
    }
  } catch (err) {
    return { error: 'Unable to connect to authentication service' };
  }
}