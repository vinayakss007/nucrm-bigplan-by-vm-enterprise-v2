/**
 * #2525 — two staff ticket handlers acted on `support_tickets` by route param alone.
 *
 * `app/api/tenant/tickets/[id]/replies/route.ts` read the ticket (subject, status,
 * priority, and the contact's name and **email**) and then interpolated those merge
 * fields into the reply body it stored — so an unscoped read was also a disclosure
 * path, not just a write hazard. Its `firstResponseAt` UPDATE had the same missing
 * scope, which is SLA/metric tampering on another tenant's ticket.
 *
 * `app/api/tenant/tickets/[id]/route.ts` PATCH was worse because it *looked* safe: the
 * UPDATE at `:202` carried `eq(supportTickets.tenantId, ctx.tenantId)` but nobody read
 * the result, so a foreign id matched zero rows and execution fell through to a
 * correctly-scoped-looking survey branch that then read `contactId`/`subject` unscoped
 * (`:210`), fetched the contact `email` **on bare `db`** outside the transaction
 * (`:219`), inserted a `csat_surveys` row bound to a foreign `ticket_id`/`contact_id`
 * pair, and mailed that person a link quoting another tenant's ticket subject.
 *
 * What is asserted here, and why each kind is needed:
 *
 *  - **The rendered SQL.** The fake hands `.where()` back the real drizzle clause, and
 *    `PgDialect.sqlToQuery` turns it into text and params, so "this statement is
 *    tenant-scoped" is a fact about the SQL the database would receive — not about a
 *    string in the source. Drop the `eq(tenantId)` and the assertion fails.
 *  - **The zero-row path.** Postgres gives a scoped `UPDATE` no rows to return for a
 *    foreign id; the mock reproduces exactly that, and the handler must answer 404 and
 *    insert nothing and send no mail. This is the half the SQL check cannot prove.
 *  - **Which connection ran the read.** `db` vs `tx` is the difference between a
 *    survey row and its ticket being written atomically and them being written in two
 *    different transactions.
 *
 * The issue also asked for a `csat_surveys` RLS policy, on the basis that grep finds no
 * `CREATE POLICY` for it. That premise is wrong, and the last test pins the correction:
 * `drizzle/migrations/0037_tenant_isolation_hardening.sql:222-252` loops over every
 * public table with a `uuid` `tenant_id` and builds `tenant_isolation … FOR ALL` —
 * `csat_surveys` qualifies and is covered, invisibly to grep. That is #2545's blind spot
 * (158 loop-built tables the literal-policy guards cannot see), not a missing policy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";

const USER_ID = "20000000-0000-4000-8000-000000000001";
const TICKET_ID = "30000000-0000-4000-8000-000000000001";
const CONTACT_ID = "40000000-0000-4000-8000-000000000001";
const CONTACT_EMAIL = "customer@example.test";
const VICTIM_SUBJECT = "Billing charged twice in September";

const harness = vi.hoisted(() => {
  const state = {
    /** Every `.where()` clause the route handed to drizzle, in call order. */
    clauses: [] as { conn: "db" | "tx"; verb: string; sql: unknown }[],
    /** Rows any SELECT returns — the victim's row, deliberately unfiltered. */
    selectRows: [] as unknown[],
    /** Rows an UPDATE `.returning()` yields: [] is Postgres saying "not yours". */
    updateReturning: [] as unknown[],
    inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  };
  return { state };
});

/**
 * Render a captured clause the way the driver would. Keeping this outside the mock
 * matters: the mock must not decide what is scoped, or the test grades its own answer.
 */
function render(sql: unknown): { text: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(sql as never);
  return { text: query.sql, params: query.params };
}

/** Renders the drizzle table symbol back to the name the database sees. */
function insertedInto(name: string) {
  return harness.state.inserts.filter((row) => {
    try {
      return getTableName(row.table as never) === name;
    } catch {
      return false;
    }
  });
}

/** The clause for the statement that mentions this table, newest match wins. */
function clauseFor(table: string, verb?: string) {
  const matches = harness.state.clauses.filter((entry) => {
    const { text } = render(entry.sql);
    return text.includes(`"${table}"`) && (!verb || entry.verb === verb);
  });
  return matches[matches.length - 1];
}

function scopedTo(table: string, verb?: string) {
  const entry = clauseFor(table, verb);
  if (!entry) return undefined;
  const { text, params } = render(entry.sql);
  return {
    text,
    params,
    /** The column appears in the predicate *and* its value is bound. */
    tenantColumn: text.includes(`"${table}"."tenant_id"`),
    bindsOwnTenant: params.includes(TENANT_ID),
    idColumn: text.includes(`"${table}"."id"`),
  };
}

const TICKET_ROW = {
  contactId: CONTACT_ID,
  subject: VICTIM_SUBJECT,
  status: "open",
  priority: "high",
  firstResponseAt: null,
  contactFirstName: "Vikram",
  contactLastName: "N",
  contactEmail: CONTACT_EMAIL,
  // The same fixture answers the PATCH's contact read, which names the columns
  // `email` / `firstName` rather than the join aliases the replies route uses.
  email: CONTACT_EMAIL,
  firstName: "Vikram",
};

/**
 * A chainable enough fake: `select().from().leftJoin()….where().limit()`,
 * `update().set().where().returning()`, `insert().values()`. Every `where()` is
 * captured and then **ignored** — that is the point. A fake that filtered by tenant
 * would hide an unscoped query instead of exposing one.
 */
function makeChain(conn: "db" | "tx") {
  const finish = (verb: string) => {
    const chain: Record<string, unknown> = {
      where: (clause: unknown) => {
        harness.state.clauses.push({ conn, verb, sql: clause });
        const tail = {
          limit: () => Promise.resolve(harness.state.selectRows),
          offset: () => Promise.resolve(harness.state.selectRows),
          orderBy: () => tail,
        };
        if (verb === "update") {
          return {
            returning: () => Promise.resolve(harness.state.updateReturning),
            ...tail,
          };
        }
        return tail;
      },
    };
    return chain;
  };

  const selectHead = {
    from: () => {
      const joinable = {
        leftJoin: () => joinable,
        innerJoin: () => joinable,
        ...finish("select"),
      };
      return joinable;
    },
  };

  return {
    select: () => selectHead,
    update: () => ({ set: () => finish("update") }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        // The table is kept by identity, not by a name guessed off its internals:
        // drizzle hangs the metadata behind a symbol, and asserting against the
        // imported schema object is the honest comparison.
        harness.state.inserts.push({ table, values });
        return {
          returning: () =>
            Promise.resolve([{ id: "00000000-0000-4000-8000-000000000001" }]),
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve(undefined).then(onOk),
        };
      },
    }),
  };
}

vi.mock("@/drizzle/db", () => {
  const chain = makeChain("db");
  return {
    db: {
      ...chain,
      transaction: (fn: (tx: unknown) => Promise<void>) => fn(makeChain("tx")),
    },
  };
});

vi.mock("@/lib/db/request-connection", () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    isAdmin: true,
    isSuperAdmin: false,
    user: { full_name: "Agent One", email: "agent@example.test" },
  })),
  requirePerm: vi.fn(() => null),
  requireModule: vi.fn(async () => null),
}));

vi.mock("@/lib/api/concurrency", () => ({
  concurrencyGuard: vi.fn(async () => null),
  concurrencyGuardById: vi.fn(async () => null),
  concurrencyGuardAsync: vi.fn(async () => null),
}));

vi.mock("@/lib/api/mutating-rate-limit", () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

const sendEmail = vi.fn(async () => undefined);
vi.mock("@/lib/email/service", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [never])),
}));

vi.mock("@/lib/errors-server", () => ({
  logError: vi.fn(async () => undefined),
}));
vi.mock("@/lib/errors", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/critical-error-alert", () => ({
  sendCriticalErrorAlert: vi.fn(async () => undefined),
}));
vi.mock("@/lib/sms", () => ({
  interpolateTemplate: (text: string) => text,
}));

function request(url: string, method: string, payload?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }) as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: TICKET_ID }) };

async function repliesPost() {
  const mod = await import("@/app/api/tenant/tickets/[id]/replies/route");
  return mod.POST as unknown as (
    request: NextRequest,
    context: unknown,
  ) => Promise<Response>;
}

async function ticketPatch() {
  const mod = await import("@/app/api/tenant/tickets/[id]/route");
  return mod.PATCH as unknown as (
    request: NextRequest,
    context: unknown,
  ) => Promise<Response>;
}

describe("#2525 — the reply handler is scoped where it reads and where it writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.clauses = [];
    harness.state.updateReturning = [{ id: TICKET_ID }];
    harness.state.selectRows = [TICKET_ROW];
    harness.state.inserts = [];
  });

  it("scopes the read that feeds the merge fields", async () => {
    const POST = await repliesPost();
    const res = await POST(
      request(
        `http://localhost/api/tenant/tickets/${TICKET_ID}/replies`,
        "POST",
        {
          body: "We are on it.",
        },
      ),
      params,
    );
    expect(res.status).toBe(201);

    const scope = scopedTo("support_tickets", "select");
    expect(scope).toBeDefined();
    expect(scope?.tenantColumn).toBe(true);
    expect(scope?.bindsOwnTenant).toBe(true);
    expect(scope?.idColumn).toBe(true);
  });

  it("scopes the firstResponseAt write, not only the read", async () => {
    const POST = await repliesPost();
    await POST(
      request(
        `http://localhost/api/tenant/tickets/${TICKET_ID}/replies`,
        "POST",
        {
          body: "First reply, public.",
        },
      ),
      params,
    );

    const scope = scopedTo("support_tickets", "update");
    expect(scope).toBeDefined();
    expect(scope?.tenantColumn).toBe(true);
    expect(scope?.bindsOwnTenant).toBe(true);
  });

  it("answers 404 and writes nothing when the ticket is not there at all", async () => {
    harness.state.selectRows = [];
    const POST = await repliesPost();
    const res = await POST(
      request(
        `http://localhost/api/tenant/tickets/${TICKET_ID}/replies`,
        "POST",
        {
          body: "Reply to a ticket I cannot see.",
        },
      ),
      params,
    );
    expect(res.status).toBe(404);
    expect(harness.state.inserts).toHaveLength(0);
  });
});

describe("#2525 — the resolve path stops when the scoped UPDATE matches no row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.clauses = [];
    harness.state.updateReturning = [{ id: TICKET_ID }];
    harness.state.selectRows = [TICKET_ROW];
    harness.state.inserts = [];
  });

  it("binds the tenant on the survey branch reads too", async () => {
    const PATCH = await ticketPatch();
    const res = await PATCH(
      request(`http://localhost/api/tenant/tickets/${TICKET_ID}`, "PATCH", {
        status: "resolved",
      }),
      params,
    );
    expect(res.status).toBe(200);

    const ticketRead = scopedTo("support_tickets", "select");
    expect(ticketRead?.tenantColumn).toBe(true);
    expect(ticketRead?.bindsOwnTenant).toBe(true);

    const contactRead = scopedTo("contacts", "select");
    expect(contactRead?.tenantColumn).toBe(true);
    expect(contactRead?.bindsOwnTenant).toBe(true);
  });

  it("reads the contact inside the transaction, not on a second connection", async () => {
    const PATCH = await ticketPatch();
    await PATCH(
      request(`http://localhost/api/tenant/tickets/${TICKET_ID}`, "PATCH", {
        status: "resolved",
      }),
      params,
    );

    const contact = clauseFor("contacts", "select");
    expect(contact).toBeDefined();
    expect(contact?.conn).toBe("tx");
  });

  it("mints the survey for the tenant that owns the ticket", async () => {
    const PATCH = await ticketPatch();
    await PATCH(
      request(`http://localhost/api/tenant/tickets/${TICKET_ID}`, "PATCH", {
        status: "resolved",
      }),
      params,
    );

    const surveys = insertedInto("csat_surveys");
    expect(surveys).toHaveLength(1);
    const survey = surveys[0];
    expect(survey?.values.tenantId).toBe(TENANT_ID);
    expect(survey?.values.ticketId).toBe(TICKET_ID);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a foreign id is a 404 — no survey row, no outbound mail naming the victim", async () => {
    // This is what Postgres really does with `WHERE tenant_id = me AND id = theirs`:
    // zero rows back. Before #2525 nobody looked, and the handler carried on.
    harness.state.updateReturning = [];

    const PATCH = await ticketPatch();
    const res = await PATCH(
      request(`http://localhost/api/tenant/tickets/${TICKET_ID}`, "PATCH", {
        status: "resolved",
      }),
      params,
    );

    expect(res.status).toBe(404);
    expect(insertedInto("csat_surveys")).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(VICTIM_SUBJECT);
  });

  it("the update it checks is the scoped one", async () => {
    const PATCH = await ticketPatch();
    await PATCH(
      request(`http://localhost/api/tenant/tickets/${TICKET_ID}`, "PATCH", {
        status: "resolved",
      }),
      params,
    );

    const update = scopedTo("support_tickets", "update");
    expect(update?.tenantColumn).toBe(true);
    expect(update?.bindsOwnTenant).toBe(true);
    expect(update?.params).toContain(TICKET_ID);
  });
});

describe("#2525 — the premise that needed correcting", () => {
  it("csat_surveys is covered by the loop-built tenant_isolation policy", async () => {
    // The issue asked for a migration on the evidence that no `CREATE POLICY`
    // mentions the table. 0037 builds policies from `pg_attribute`, so absence of
    // the literal name proves nothing — and #2545 exists for exactly this gap.
    const fs = await import("fs");
    const migration = fs.readFileSync(
      "drizzle/migrations/0037_tenant_isolation_hardening.sql",
      "utf8",
    );
    expect(migration).toContain("a.attname = 'tenant_id'");
    expect(migration).toContain("CREATE POLICY tenant_isolation ON %I FOR ALL");

    const schema = await import("@/drizzle/schema");
    expect(getTableName(schema.csatSurveys)).toBe("csat_surveys");
    // The two properties 0037's loop selects on: a uuid `tenant_id`, present.
    expect(schema.csatSurveys.tenantId).toBeDefined();
    expect(schema.csatSurveys.tenantId.name).toBe("tenant_id");
  });
});
