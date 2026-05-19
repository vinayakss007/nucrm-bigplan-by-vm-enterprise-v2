'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        window.location.href = '/tenant/dashboard';
      } else {
        const data = await res.json();
        setError(data.error || 'Login failed');
        setLoading(false);
      }
    } catch (err) {
      setError('Connection error');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: 32, background: 'white', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 700, textAlign: 'center', color: '#4f46e5' }}>NuCRM</h1>
        <p style={{ margin: '0 0 24px', textAlign: 'center', color: '#6b7280' }}>Sign in</p>

        {error && <div style={{ padding: 12, marginBottom: 16, background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: 14 }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input name="email" type="email" placeholder="Email" required style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <input name="password" type="password" placeholder="Password" required style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }} />
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 14, background: loading ? '#9ca3af' : '#4f46e5', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}