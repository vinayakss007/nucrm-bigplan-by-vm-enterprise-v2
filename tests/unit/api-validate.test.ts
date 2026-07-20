import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateBody,
  validateQuery,
  validateField,
  withValidation,
  safeJson,
} from '@/lib/api/validate';

const createContactSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  email: z.string().email('Invalid email'),
  age: z.number().int().min(0).optional(),
});

describe('validateBody', () => {
  it('returns { data } on valid input', () => {
    const result = validateBody(createContactSchema, {
      first_name: 'John',
      email: 'john@test.com',
    });
    expect(result).toHaveProperty('data');
    expect((result as { data: typeof createContactSchema._type }).data.first_name).toBe('John');
  });

  it('returns NextResponse 400 with field-level errors on invalid input', () => {
    const result = validateBody(createContactSchema, {
      first_name: '',
      email: 'not-an-email',
    });
    expect(result).toHaveProperty('status', 400);
  });

  it('includes details array in 400 response', async () => {
    const result = validateBody(createContactSchema, {});
    expect(result).toHaveProperty('status', 400);
    const json = await (result as Response).json();
    expect(json.error).toBe('Validation failed');
    expect(Array.isArray(json.details)).toBe(true);
    expect(json.details.length).toBeGreaterThan(0);
  });

  it('returns error for non-ZodError (unexpected throw)', () => {
    const badSchema = {
      parse: () => { throw new Error('unexpected'); },
    } as unknown as z.ZodSchema;
    const result = validateBody(badSchema, {});
    expect(result).toHaveProperty('status', 400);
  });
});

describe('validateQuery', () => {
  const querySchema = z.object({
    page: z.string().regex(/^\d+$/).optional(),
    sort: z.enum(['asc', 'desc']).optional(),
  });

  it('returns { data } on valid query params', () => {
    const result = validateQuery(querySchema, { page: '1', sort: 'desc' });
    expect(result).toHaveProperty('data');
    expect((result as { data: { page: string } }).data.page).toBe('1');
  });

  it('returns NextResponse 400 on invalid query params', async () => {
    const result = validateQuery(querySchema, { sort: 'invalid' });
    expect(result).toHaveProperty('status', 400);
    const json = await (result as Response).json();
    expect(json.error).toBe('Invalid query parameters');
  });

  it('handles missing optional params', () => {
    const result = validateQuery(querySchema, {});
    expect(result).toHaveProperty('data');
  });

  it('returns error for non-ZodError', () => {
    const badSchema = {
      parse: () => { throw new Error('unexpected'); },
    } as unknown as z.ZodSchema;
    const result = validateQuery(badSchema, {});
    expect(result).toHaveProperty('status', 400);
  });
});

describe('validateField', () => {
  it('returns parsed value on valid input', () => {
    const schema = z.string().min(3);
    expect(validateField(schema, 'hello')).toBe('hello');
  });

  it('throws ZodError on invalid input', () => {
    const schema = z.string().min(3);
    expect(() => validateField(schema, 'ab')).toThrow();
  });
});

describe('withValidation', () => {
  it('calls handler with validated body on valid JSON', async () => {
    const handler = withValidation(createContactSchema, async (_req, ctx, body) => {
      return Response.json({ received: body });
    });

    const request = new Request('http://localhost/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', email: 'jane@test.com' }),
    });

    const response = await handler(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.received.first_name).toBe('Jane');
  });

  it('returns 400 on invalid JSON body', async () => {
    const handler = withValidation(createContactSchema, async (_req, _ctx, body) => {
      return Response.json({ received: body });
    });

    const request = new Request('http://localhost/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const response = await handler(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 with field errors on schema failure', async () => {
    const handler = withValidation(createContactSchema, async (_req, _ctx, body) => {
      return Response.json({ received: body });
    });

    const request = new Request('http://localhost/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: '', email: 'bad' }),
    });

    const response = await handler(request);
    expect(response.status).toBe(400);
  });
});

describe('safeJson', () => {
  it('returns { data } on valid JSON', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
    });
    const result = await safeJson(request);
    expect(result).toHaveProperty('data');
    expect((result as { data: { key: string } }).data.key).toBe('value');
  });

  it('returns 400 on invalid JSON', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: 'not-json',
    });
    const result = await safeJson(request);
    expect(result).toHaveProperty('status', 400);
  });
});
