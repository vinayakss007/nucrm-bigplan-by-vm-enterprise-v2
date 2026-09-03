import { test, expect, describe, vi } from 'vitest';
import { POST } from '@/app/api/tenant/whatsapp/templates/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => ({ tenantId: 'test-tenant' })
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => [{
              config: {
                access_token: 'test_token',
                business_account_id: '12345'
              }
            }]
          })
        })
      })
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn()
      }))
    }))
  }
}));

// Mock fetch
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
        data: Array.from({ length: 1000 }).map((_, i) => ({
            name: `template_${i}`,
            language: 'en',
            category: 'MARKETING',
            status: 'APPROVED',
            components: []
        }))
    })
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: (fn: any) => fn
}));

describe('WhatsApp Templates Sync Benchmark', () => {
    test('performance', async () => {
        const req = new NextRequest('http://localhost/api/tenant/whatsapp/templates', { method: 'POST' });

        const start = performance.now();
        await POST(req as any, {} as any);
        const end = performance.now();

        console.log(`Sync execution time: ${end - start} ms`);
        expect(end - start).toBeLessThan(5000);
    });
});
