import { test } from 'vitest';
import { performance } from 'perf_hooks';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';

// We will mock requireAuth and db
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ tenantId: 'tenant-1', isAdmin: true })
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (fn: any) => fn
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    transaction: async (cb: any) => {
      const tx = {
        insert: (table: any) => ({
          values: (vals: any) => {
            const arr = Array.isArray(vals) ? vals : [vals];
            return {
              onConflictDoNothing: async () => {
                await new Promise(r => setTimeout(r, 2));
              },
              returning: async () => {
                await new Promise(r => setTimeout(r, 2));
                return [{ id: 'pipe-1' }];
              },
              then: (resolve: any) => {
                setTimeout(() => resolve([{ id: 'pipe-1' }]), 2);
              }
            };
          }
        })
      };
      return cb(tx);
    }
  }
}));

test('benchmark', async () => {
  const { POST } = await import('@/app/api/tenant/industry-templates/route');

  const req = new NextRequest('http://localhost/api/tenant/industry-templates', {
    method: 'POST',
    body: JSON.stringify({ templateId: 'saas' })
  });

  const start = performance.now();
  await POST(req as any, {} as any);
  const end = performance.now();

  console.log(`Execution time: ${(end - start).toFixed(2)} ms`);
});
