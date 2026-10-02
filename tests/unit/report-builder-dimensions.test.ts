import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * The report builder advertises its dimensions from GET and executes whatever
 * id the UI sends back. Three advertised ids never named a real column
 * (deals.stage, companies.size, activities.type) and one advertised metric
 * field does not exist at all (deals.win_probability), so the most obvious
 * grouping on the most obvious entity answered 500 with a Postgres
 * "column does not exist" behind it.
 *
 * These tests walk the advertised contract itself, so adding a dropdown option
 * that the schema cannot answer fails here instead of in production.
 */

const mockCtx = { tenantId: 'tenant-1', userId: 'user-1', isAdmin: true };
const mockRequireAuth = vi.fn();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('server-only', () => ({}));

const route = await import('@/app/api/tenant/reports/builder/route');
const { GET } = route;

const crm = await import('@/drizzle/schema');
const { supportTickets } = await import('@/drizzle/schema/support');

/** Real Postgres column names on a drizzle table object. */
function columnNames(table: object): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(table)) {
    const col = value as { columnType?: string; name?: string };
    if (col && typeof col === 'object' && col.columnType?.startsWith('Pg') && col.name) out.add(col.name);
  }
  return out;
}

const TABLES: Record<string, object> = {
  contacts: crm.contacts,
  deals: crm.deals,
  tasks: crm.tasks,
  companies: crm.companies,
  activities: crm.activities,
  quotes: crm.quotes,
  invoices: crm.invoices,
  // The public id is 'tickets'; the query runs against support_tickets.
  tickets: supportTickets,
  leads: crm.leads,
};

// Dimensions the resolver answers from an expression rather than a bare column.
const EXPRESSION_DIMENSIONS = new Set([
  'created_at_month', 'created_at_week', 'close_date_month', 'completed',
]);

function req(): import('next/server').NextRequest {
  return new Request('http://localhost/api/tenant/reports/builder') as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(mockCtx);
});

describe('report builder advertised contract', () => {
  it('knows every entity it offers', async () => {
    const json = await (await GET(req())).json();
    expect(json.entities.length).toBeGreaterThan(5);
    for (const entity of json.entities) expect(TABLES[entity.id]).toBeTruthy();
  });

  it('every advertised groupBy resolves to a real column or a known expression', async () => {
    const json = await (await GET(req())).json();
    const problems: string[] = [];
    for (const entity of json.entities) {
      const cols = columnNames(TABLES[entity.id]);
      for (const option of entity.groupByOptions) {
        if (EXPRESSION_DIMENSIONS.has(option.id)) continue;
        // `stage` is a uuid FK resolved through a subquery on deal_stages;
        // `size`/`type` are aliased to their prefixed column names.
        const resolved = entity.id === 'deals' && option.id === 'stage'
          ? 'stage_id'
          : ({ size: 'company_size', type: 'event_type' }[option.id] ?? option.id);
        if (!cols.has(resolved)) problems.push(`${entity.id}.${option.id} -> "${resolved}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every advertised metric field is a real column', async () => {
    const json = await (await GET(req())).json();
    const problems: string[] = [];
    for (const entity of json.entities) {
      const cols = columnNames(TABLES[entity.id]);
      for (const option of entity.metricOptions) {
        if (!option.field) continue;
        if (!cols.has(option.field)) problems.push(`${entity.id}.${option.field}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('no longer offers the deals probability metric that has no column', async () => {
    const json = await (await GET(req())).json();
    const deals = json.entities.find((e: { id: string }) => e.id === 'deals');
    expect(deals.metricOptions.some((m: { field?: string }) => m.field === 'win_probability')).toBe(false);
  });
});

describe('resolveGroupExpression', () => {
  const dialect = new PgDialect();
  const toSql = (f: unknown) => dialect.sqlToQuery(f as never).sql;

  it('labels deals stages by name instead of by uuid', () => {
    const sqlText = toSql(route.resolveGroupExpression('deals', 'stage'));
    expect(sqlText).toMatch(/deal_stages/);
    expect(sqlText).toMatch(/stage_id/);
    // Grouping on the raw uuid is what made every bar an unreadable id.
    expect(sqlText).not.toMatch(/COALESCE\("stage"/);
  });

  it('maps the renamed columns rather than emitting the public id', () => {
    expect(toSql(route.resolveGroupExpression('companies', 'size'))).toMatch(/company_size/);
    expect(toSql(route.resolveGroupExpression('activities', 'type'))).toMatch(/event_type/);
  });

  it('keeps plain dimensions as their own column', () => {
    expect(toSql(route.resolveGroupExpression('deals', 'assigned_to'))).toMatch(/"assigned_to"/);
  });
});
