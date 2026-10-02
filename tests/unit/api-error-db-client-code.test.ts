/**
 * A route that catches its own DB error answers through apiError(), never
 * reaching withApiRoute's mapping — which is why ~90 [id] endpoints returned
 * 500 for /api/tenant/deals/not-a-uuid and paged an operator for a typo.
 * Both paths must now agree, so these assert apiError's statuses match the
 * classifier's documented contract and that a client fault is silent to Sentry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/errors', () => ({
  logError: vi.fn(),
}));

vi.mock('@/lib/critical-error-alert', () => ({
  sendCriticalErrorAlert: vi.fn().mockResolvedValue(undefined),
}));

// The structured [api] line is what carries the constraint name, so the logger
// has to be a spy rather than writing to the suite's stdout.
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function pgError(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  // node-postgres names every query failure DatabaseError, so a status choice
  // that keyed off the name alone would have called this a server fault.
  err.name = 'DatabaseError';
  return err;
}

const uuidCast = () => pgError('invalid input syntax for type uuid: "not-a-uuid"', '22P02');

/** Postgres names the refused constraint on the error; drizzle keeps it there. */
function checkViolation(constraint: string) {
  const err = pgError(
    `new row for relation "invoices" violates check constraint "${constraint}"`,
    '23514',
  ) as Error & { constraint: string };
  err.constraint = constraint;
  return err;
}

describe('apiError maps client-caused Postgres errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('answers 404 for a malformed uuid under GET', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    const res = runWithHttpMethod('GET', () => apiError(uuidCast()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('reads the SQLSTATE through the wrapper drizzle actually throws', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    // drizzle's node-postgres driver rethrows a failed query as QueryFailedError:
    // the SQL text becomes this message and the pg error carrying code 22P02 is
    // only reachable on `cause`. A classifier reading the top level alone mapped
    // nothing, which is how the [id] routes kept answering 500.
    const wrapper = new Error(
      'Failed query: select "id" from "deals" where "deals"."id" = $1 and "deals"."tenant_id" = $2'
    ) as Error & { cause: unknown };
    wrapper.cause = uuidCast();
    const res = runWithHttpMethod('GET', () => apiError(wrapper));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('answers 400 for a malformed uuid under POST', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    const res = runWithHttpMethod('POST', () => apiError(uuidCast()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid identifier in request body' });
  });

  it('answers 400 when it cannot see the verb', async () => {
    const { apiError } = await import('@/lib/api-error');
    const res = apiError(uuidCast());
    expect(res.status).toBe(400);
  });

  it('answers 409 for a duplicate key and 400 for a dangling reference', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    const conflict = runWithHttpMethod('POST', () =>
      apiError(pgError('duplicate key value violates unique constraint "roles_tenant_name_key"', '23505')));
    const fk = runWithHttpMethod('POST', () =>
      apiError(pgError('insert or update on table "deals" violates foreign key constraint', '23503')));
    expect(conflict.status).toBe(409);
    expect(fk.status).toBe(400);
  });

  it('does not report to Sentry or page for a client typo', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { apiError } = await import('@/lib/api-error');
    apiError(uuidCast());
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(sendCriticalErrorAlert).not.toHaveBeenCalled();
  });

  it('leaves a 22P02 on a non-uuid type as a 500', async () => {
    const { apiError } = await import('@/lib/api-error');
    const res = apiError(pgError('invalid input syntax for type integer: "x"', '22P02'));
    expect(res.status).toBe(500);
  });
});

/**
 * A CHECK constraint only refuses a value, and the value came from the request,
 * so 23514 is a client fault. Six write surfaces reach it today: the zod schema
 * offers a vocabulary the table rejects (invoices.status 'void', quotes.status
 * 'won', support_tickets.priority 'critical', contracts.status 'signed',
 * sequences.status 'completed', announcements.type 'maintenance'), and each one
 * answered 500 — a Sentry issue and a critical-error page for what is either a
 * caller typo or enum drift on our side.
 */
describe('apiError treats a check-constraint refusal as a client fault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('answers 400 without leaking the constraint name', async () => {
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    const res = runWithHttpMethod('POST', () => apiError(checkViolation('chk_invoices_status')));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid value for a constrained field' });
    expect(JSON.stringify(body)).not.toContain('chk_invoices_status');
  });

  it('records which constraint refused the row', async () => {
    const { logger } = await import('@/lib/logger');
    const { apiError } = await import('@/lib/api-error');
    const { runWithHttpMethod } = await import('@/lib/api/db-client-error');
    runWithHttpMethod('POST', () => apiError(checkViolation('chk_support_tickets_priority')));
    const logged = vi.mocked(logger.error).mock.calls.find(([msg]) => msg === '[api]');
    expect(logged?.[1]).toMatchObject({
      status: 400,
      constraint: 'chk_support_tickets_priority',
    });
  });

  it('reads 23514 through the wrapper drizzle actually throws', async () => {
    const { apiError } = await import('@/lib/api-error');
    const wrapper = new Error('Failed query: insert into "quotes" (…) values (…)') as Error & { cause: unknown };
    wrapper.cause = checkViolation('chk_quotes_status');
    const res = apiError(wrapper);
    expect(res.status).toBe(400);
  });

  it('does not report to Sentry or page for a rejected enum value', async () => {
    const Sentry = await import('@sentry/nextjs');
    const { sendCriticalErrorAlert } = await import('@/lib/critical-error-alert');
    const { apiError } = await import('@/lib/api-error');
    apiError(checkViolation('chk_contracts_status'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(sendCriticalErrorAlert).not.toHaveBeenCalled();
  });
});

/**
 * The classifier above only helps an error that reaches it. Invoices, quotes and
 * contracts POST end their catch with a literal
 * `NextResponse.json({ error: 'Failed to create X' }, { status: 500 })`, so a
 * CHECK violation was answered 500 (plus a Sentry issue and a critical page)
 * while the equivalent ticket and sequence routes answered 400. This is the one
 * line such a route needs before its own 500 — and it must stay silent for
 * errors the caller did not cause, or real faults stop pages.
 */
describe('clientDbErrorResponse catches what a route swallowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('returns the 400 response the route should send', async () => {
    const { clientDbErrorResponse } = await import('@/lib/api/db-client-error');
    const res = clientDbErrorResponse(checkViolation('chk_invoices_status'), 'POST');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    expect(await res!.json()).toEqual({ error: 'Invalid value for a constrained field' });
  });

  it('returns null for a real server fault so the route keeps its 500', async () => {
    const { clientDbErrorResponse } = await import('@/lib/api/db-client-error');
    expect(clientDbErrorResponse(
      pgError('connection terminated unexpectedly', '08006'), 'POST')).toBeNull();
    expect(clientDbErrorResponse(new Error('TypeError: x is undefined'), 'POST')).toBeNull();
  });

  it('names the constraint in the log so our own drift stays visible', async () => {
    const { logger } = await import('@/lib/logger');
    const { clientDbErrorResponse } = await import('@/lib/api/db-client-error');
    clientDbErrorResponse(checkViolation('chk_contracts_contract_type'), 'POST');
    const warned = vi.mocked(logger.warn).mock.calls
      .find(([m]) => m === '[api] check-constraint refusal');
    expect(warned?.[1]).toMatchObject({ constraint: 'chk_contracts_contract_type' });
  });

  it('stays quiet for a caller-side typo, which is not our drift', async () => {
    const { logger } = await import('@/lib/logger');
    const { clientDbErrorResponse } = await import('@/lib/api/db-client-error');
    expect(clientDbErrorResponse(uuidCast(), 'GET')?.status).toBe(404);
    expect(vi.mocked(logger.warn).mock.calls
      .some(([m]) => m === '[api] check-constraint refusal')).toBe(false);
  });

  it('reads the verb from withApiRoute when the route does not pass one', async () => {
    const { clientDbErrorResponse, runWithHttpMethod } = await import('@/lib/api/db-client-error');
    // Same route file serves GET and POST; hardcoding 'POST' in the GET branch's
    // catch would turn a malformed uuid into "Not found" for a list endpoint.
    const asGet = runWithHttpMethod('GET', () => clientDbErrorResponse(uuidCast()));
    expect(asGet!.status).toBe(404);
    const asPost = runWithHttpMethod('POST', () => clientDbErrorResponse(uuidCast()));
    expect(asPost!.status).toBe(400);
  });
});
