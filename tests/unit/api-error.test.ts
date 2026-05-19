import { describe, it, expect } from 'vitest';
import { apiError, notFound, badRequest, unauthorized, forbidden } from '@/lib/api-error';

async function getBody(res: Response): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

describe('apiError', () => {
  it('returns 500 in production with generic message', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = apiError(new Error('hidden'));
      expect(res.status).toBe(500);
      const body = await getBody(res);
      expect(body.error).toBe('Internal server error');
    } finally { process.env.NODE_ENV = prev; }
  });

  it('returns error message in development', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = apiError(new Error('dev error'));
      expect(res.status).toBe(500);
      const body = await getBody(res);
      expect(body.error).toBe('dev error');
    } finally { process.env.NODE_ENV = prev; }
  });

  it('returns custom status and message', async () => {
    const res = apiError(new Error('bad'), 'Custom error', 400);
    expect(res.status).toBe(400);
    const body = await getBody(res);
    expect(body.error).toBe('Custom error');
  });
});

describe('notFound', () => {
  it('returns 404', () => {
    expect(notFound().status).toBe(404);
  });

  it('includes entity name', async () => {
    const body = await getBody(notFound('Contact'));
    expect(body.error).toBe('Contact not found');
  });
});

describe('badRequest', () => {
  it('returns 400', () => {
    expect(badRequest('Invalid input').status).toBe(400);
  });

  it('includes message', async () => {
    const body = await getBody(badRequest('Invalid input'));
    expect(body.error).toBe('Invalid input');
  });
});

describe('unauthorized', () => {
  it('returns 401', () => {
    expect(unauthorized().status).toBe(401);
  });

  it('includes custom message', async () => {
    const body = await getBody(unauthorized('Login required'));
    expect(body.error).toBe('Login required');
  });
});

describe('forbidden', () => {
  it('returns 403', () => {
    expect(forbidden().status).toBe(403);
  });

  it('includes custom message', async () => {
    const body = await getBody(forbidden('Admin only'));
    expect(body.error).toBe('Admin only');
  });
});
