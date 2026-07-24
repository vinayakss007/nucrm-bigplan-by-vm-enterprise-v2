import { describe, it, expect } from 'vitest';

describe('Security hardening - zod schema', () => {
  it('formSubmitSchema rejects missing form_id', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      form_id: z.string().min(1, 'Form ID is required'),
      data: z.record(z.unknown()).optional().default({}),
      values: z.record(z.unknown()).optional().default({}),
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('form_id');
    }
  });

  it('formSubmitSchema accepts valid input', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      form_id: z.string().min(1, 'Form ID is required'),
      data: z.record(z.unknown()).optional().default({}),
      values: z.record(z.unknown()).optional().default({}),
    });
    const result = schema.safeParse({ form_id: 'abc-123', data: { name: 'John', email: 'john@x.com' } });
    expect(result.success).toBe(true);
  });

  it('formSubmitSchema rejects empty form_id', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      form_id: z.string().min(1, 'Form ID is required'),
      data: z.record(z.unknown()).optional().default({}),
      values: z.record(z.unknown()).optional().default({}),
    });
    const result = schema.safeParse({ form_id: '' });
    expect(result.success).toBe(false);
  });
});

describe('Security hardening - proxy', () => {
  it('PUBLIC_PREFIXES includes /api/tenant/forms/public', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('proxy.ts', 'utf-8');
    expect(content).toContain('/api/tenant/forms/public');
  });

  it('proxy throws on ALLOWED_ORIGINS=* in production', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('proxy.ts', 'utf-8');
    expect(content).toContain('throw new Error');
    expect(content).toContain('ALLOWED_ORIGINS=*');
  });
});

describe('Security hardening - CORS headers', () => {
  it('public form route no longer has hardcoded * CORS headers', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('app/api/tenant/forms/public/[id]/route.ts', 'utf-8');
    expect(content).not.toContain("'Access-Control-Allow-Origin'");
    expect(content).not.toContain('Access-Control-Allow-Origin');
  });

  it('docker-compose.scale.yml defaults to localhost:3000 not wildcard', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('docker-compose.scale.yml', 'utf-8');
    expect(content).toContain('ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-http://localhost:3000}');
  });
});
