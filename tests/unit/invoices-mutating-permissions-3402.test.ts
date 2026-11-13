/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Mutating invoices money path permission gates.
 *
 * Verifies that the catalog ids `invoices.create` and `invoices.send` (and `invoices.view`)
 * are strictly enforced on:
 *   - POST /api/tenant/invoices (requires invoices.create)
 *   - GET  /api/tenant/invoices (requires invoices.view)
 *   - POST /api/tenant/invoices/[id]/send (requires invoices.send)
 *   - POST /api/tenant/quotes/[id]/convert-to-invoice (requires invoices.create)
 *
 * An unprivileged tenant member without the required permission gets 403 with
 * structured error and the handler executes no business logic or writes.
 * Users with the explicit grant, admins, and superadmins pass the permission gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import {
  GET as getInvoices,
  POST as postInvoice,
} from "@/app/api/tenant/invoices/route";
import { POST as postSendInvoice } from "@/app/api/tenant/invoices/[id]/send/route";
import { POST as postConvertToInvoice } from "@/app/api/tenant/quotes/[id]/convert-to-invoice/route";

interface AuthCtx {
  tenantId: string;
  userId: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  permissions?: Record<string, boolean>;
}

let mockAuthCtx: AuthCtx = {
  tenantId: "tenant-1",
  userId: "user-1",
  isAdmin: false,
  isSuperAdmin: false,
  permissions: {},
};

vi.mock("@/lib/api/with-api-route", () => ({
  withApiRoute: <T>(h: T) => h,
}));

vi.mock("@/lib/api/mutating-rate-limit", () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock("@/lib/errors-server", () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: vi.fn(() => ({})),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/email/service", () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/auth/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAuth: vi.fn(async () => mockAuthCtx),
    requireCsrf: vi.fn(() => null),
    requirePerm: (ctx: AuthCtx, perm: string) => {
      if (
        ctx.isSuperAdmin ||
        ctx.isAdmin ||
        ctx.permissions?.["all"] === true ||
        ctx.permissions?.[perm] === true
      ) {
        return null;
      }
      return NextResponse.json(
        { error: `Permission denied: ${perm} required` },
        { status: 403 },
      );
    },
  };
});

interface FakeChain {
  from(): FakeChain;
  where(): FakeChain;
  orderBy(): FakeChain;
  limit(): FakeChain;
  offset(): FakeChain;
  returning(): FakeChain;
  then(resolve: (v: unknown) => void): void;
}

const chainable = (result: unknown): FakeChain => ({
  from: () => chainable(result),
  where: () => chainable(result),
  orderBy: () => chainable(result),
  limit: () => chainable(result),
  offset: () => chainable(result),
  returning: () => chainable(result),
  then: (resolve: (v: unknown) => void) => resolve(result),
});

vi.mock("@/drizzle/db", () => ({
  db: {
    select: () => chainable([{ count: 0, id: "inv-1", taxRate: "0.00" }]),
    insert: () => ({
      values: () => chainable([{ id: "inv-1" }]),
    }),
    update: () => ({
      set: () => chainable([{ id: "inv-1" }]),
    }),
    query: {
      invoices: {
        findFirst: async () => ({
          id: "inv-1",
          tenantId: "tenant-1",
          status: "draft",
          totalAmount: "100.00",
          title: "Invoice 1",
          invoiceNumber: "INV-001",
          contactId: null,
          deletedAt: null,
        }),
      },
      quotes: {
        findFirst: async () => ({
          id: "quote-1",
          tenantId: "tenant-1",
          status: "accepted",
          deletedAt: null,
        }),
      },
      contacts: {
        findFirst: async () => null,
      },
    },
    transaction: async (cb: (tx: unknown) => unknown) => {
      const tx = {
        select: () => chainable([{ maxNum: 1 }]),
        insert: () => ({
          values: () => chainable([{ id: "inv-1" }]),
        }),
        update: () => ({
          set: () => chainable([{ id: "inv-1", status: "sent" }]),
        }),
        query: {
          invoices: {
            findFirst: async () => ({ id: "inv-1", status: "sent" }),
          },
        },
      };
      return cb(tx);
    },
  },
}));

function makeRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
): NextRequest {
  const { method = "GET", body } = options;
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(
    `http://localhost:3000${path}`,
    init,
  ) as unknown as NextRequest;
}

describe("PR-2E (#3402) — mutating invoices money path permission gates", () => {
  beforeEach(() => {
    mockAuthCtx = {
      tenantId: "tenant-1",
      userId: "user-1",
      isAdmin: false,
      isSuperAdmin: false,
      permissions: {},
    };
  });

  describe("POST /api/tenant/invoices (invoices.create)", () => {
    const validBody = {
      issue_date: "2026-11-13",
      due_date: "2026-12-13",
      line_items: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
    };

    it("returns 403 when user lacks invoices.create", async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest("/api/tenant/invoices", {
        method: "POST",
        body: validBody,
      });
      const res = await postInvoice(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("invoices.create required");
    });

    it("permits user with explicit invoices.create grant", async () => {
      mockAuthCtx.permissions = { "invoices.create": true };
      const req = makeRequest("/api/tenant/invoices", {
        method: "POST",
        body: validBody,
      });
      const res = await postInvoice(req);
      expect(res.status).not.toBe(403);
    });

    it("permits admin without explicit permission grant", async () => {
      mockAuthCtx.isAdmin = true;
      mockAuthCtx.permissions = {};
      const req = makeRequest("/api/tenant/invoices", {
        method: "POST",
        body: validBody,
      });
      const res = await postInvoice(req);
      expect(res.status).not.toBe(403);
    });
  });

  describe("GET /api/tenant/invoices (invoices.view)", () => {
    it("returns 403 when user lacks invoices.view", async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest("/api/tenant/invoices?limit=10&offset=0");
      const res = await getInvoices(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("invoices.view required");
    });

    it("permits user with explicit invoices.view grant", async () => {
      mockAuthCtx.permissions = { "invoices.view": true };
      const req = makeRequest("/api/tenant/invoices?limit=10&offset=0");
      const res = await getInvoices(req);
      expect(res.status).toBe(200);
    });

    it("permits admin user", async () => {
      mockAuthCtx.isAdmin = true;
      const req = makeRequest("/api/tenant/invoices?limit=10&offset=0");
      const res = await getInvoices(req);
      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/tenant/invoices/[id]/send (invoices.send)", () => {
    const params = { params: Promise.resolve({ id: "inv-1" }) };

    it("returns 403 when user lacks invoices.send", async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest("/api/tenant/invoices/inv-1/send", {
        method: "POST",
        body: { to_email: "client@example.com" },
      });
      const res = await postSendInvoice(req, params);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("invoices.send required");
    });

    it("permits user with explicit invoices.send grant", async () => {
      mockAuthCtx.permissions = { "invoices.send": true };
      const req = makeRequest("/api/tenant/invoices/inv-1/send", {
        method: "POST",
        body: { to_email: "client@example.com" },
      });
      const res = await postSendInvoice(req, params);
      expect(res.status).not.toBe(403);
    });

    it("permits admin user", async () => {
      mockAuthCtx.isAdmin = true;
      const req = makeRequest("/api/tenant/invoices/inv-1/send", {
        method: "POST",
        body: { to_email: "client@example.com" },
      });
      const res = await postSendInvoice(req, params);
      expect(res.status).not.toBe(403);
    });
  });

  describe("POST /api/tenant/quotes/[id]/convert-to-invoice (invoices.create)", () => {
    const params = { params: Promise.resolve({ id: "quote-1" }) };

    it("returns 403 when user lacks invoices.create", async () => {
      mockAuthCtx.permissions = {};
      const req = makeRequest("/api/tenant/quotes/quote-1/convert-to-invoice", {
        method: "POST",
        body: { due_date: "2026-12-13" },
      });
      const res = await postConvertToInvoice(req, params);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("invoices.create required");
    });

    it("permits user with explicit invoices.create grant", async () => {
      mockAuthCtx.permissions = { "invoices.create": true };
      const req = makeRequest("/api/tenant/quotes/quote-1/convert-to-invoice", {
        method: "POST",
        body: { due_date: "2026-12-13" },
      });
      const res = await postConvertToInvoice(req, params);
      expect(res.status).not.toBe(403);
    });

    it("permits superAdmin user", async () => {
      mockAuthCtx.isSuperAdmin = true;
      const req = makeRequest("/api/tenant/quotes/quote-1/convert-to-invoice", {
        method: "POST",
        body: { due_date: "2026-12-13" },
      });
      const res = await postConvertToInvoice(req, params);
      expect(res.status).not.toBe(403);
    });
  });
});
