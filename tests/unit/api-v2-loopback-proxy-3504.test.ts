/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockResolveGatewayTenant = vi.fn();
const mockValidateCORS = vi.fn();

vi.mock("@/lib/api/gateway", () => ({
  resolveGatewayTenant: (...args: unknown[]) =>
    mockResolveGatewayTenant(...args),
  validateCORS: (...args: unknown[]) => mockValidateCORS(...args),
}));

describe("#3504 API v2 clean deprecation and redirect without loopback proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveGatewayTenant.mockResolvedValue({
      tenantId: "tenant-test-123",
      source: "header",
    });
    mockValidateCORS.mockResolvedValue(true);
  });

  describe("GET /api/v2 root metadata", () => {
    it("returns deprecation status, successor link, and deprecation headers", async () => {
      const { GET } = await import("@/app/api/v2/route");
      const req = new NextRequest("http://localhost:3000/api/v2");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.version).toBe("v2");
      expect(data.status).toBe("deprecated");
      expect(data.deprecated).toBe(true);
      expect(data.successor).toBe("/api/tenant");

      expect(res.headers.get("Deprecation")).toBe("true");
      expect(res.headers.get("Sunset")).toBeTruthy();
      expect(res.headers.get("Link")).toContain(
        '</api/tenant>; rel="successor-version"',
      );
      expect(res.headers.get("X-Deprecation-Notice")).toContain("deprecated");
    });
  });

  describe("OPTIONS /api/v2/[...path]", () => {
    it("returns 204 with CORS preflight headers", async () => {
      const { OPTIONS } = await import("@/app/api/v2/[...path]/route");
      const req = new NextRequest("http://localhost:3000/api/v2/contacts", {
        headers: { origin: "https://example.com" },
      });
      const res = await OPTIONS(req);

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://example.com",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    });
  });

  describe("Authorization and CORS gates", () => {
    it("returns 401 when tenant resolution fails", async () => {
      mockResolveGatewayTenant.mockResolvedValue(null);
      const { GET } = await import("@/app/api/v2/[...path]/route");
      const req = new NextRequest("http://localhost:3000/api/v2/contacts");
      const res = await GET(req, {
        params: Promise.resolve({ path: ["contacts"] }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 403 when CORS origin is disallowed for tenant", async () => {
      mockValidateCORS.mockResolvedValue(false);
      const { GET } = await import("@/app/api/v2/[...path]/route");
      const req = new NextRequest("http://localhost:3000/api/v2/contacts", {
        headers: { origin: "https://malicious.example" },
      });
      const res = await GET(req, {
        params: Promise.resolve({ path: ["contacts"] }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("Origin not allowed");
    });
  });

  describe("HTTP verb redirects and query parameter preservation", () => {
    it("redirects GET /api/v2/contacts to /api/tenant/contacts with 308 and deprecation headers", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { GET } = await import("@/app/api/v2/[...path]/route");
      const req = new NextRequest(
        "http://localhost:3000/api/v2/contacts?status=active&limit=50",
        {
          headers: { origin: "https://app.example.com" },
        },
      );
      const res = await GET(req, {
        params: Promise.resolve({ path: ["contacts"] }),
      });

      expect(res.status).toBe(308);
      expect(res.headers.get("Location")).toBe(
        "http://localhost:3000/api/tenant/contacts?status=active&limit=50",
      );
      expect(res.headers.get("Deprecation")).toBe("true");
      expect(res.headers.get("Sunset")).toBeTruthy();
      expect(res.headers.get("Link")).toBe(
        '</api/tenant/contacts>; rel="successor-version"',
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com",
      );

      // Crucial: loopback fetch is completely eliminated
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("redirects mutating POST with 307 to preserve method and payload", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const { POST } = await import("@/app/api/v2/[...path]/route");
      const req = new NextRequest("http://localhost:3000/api/v2/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New Deal" }),
      });
      const res = await POST(req, {
        params: Promise.resolve({ path: ["deals"] }),
      });

      expect(res.status).toBe(307);
      expect(res.headers.get("Location")).toBe(
        "http://localhost:3000/api/tenant/deals",
      );
      expect(res.headers.get("Deprecation")).toBe("true");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("redirects PUT, PATCH, DELETE with 307 to matching tenant endpoints", async () => {
      const { PUT, PATCH, DELETE } =
        await import("@/app/api/v2/[...path]/route");

      const putReq = new NextRequest(
        "http://localhost:3000/api/v2/deals/deal-1",
        { method: "PUT" },
      );
      const putRes = await PUT(putReq, {
        params: Promise.resolve({ path: ["deals", "deal-1"] }),
      });
      expect(putRes.status).toBe(307);
      expect(putRes.headers.get("Location")).toBe(
        "http://localhost:3000/api/tenant/deals/deal-1",
      );

      const patchReq = new NextRequest(
        "http://localhost:3000/api/v2/deals/deal-1",
        { method: "PATCH" },
      );
      const patchRes = await PATCH(patchReq, {
        params: Promise.resolve({ path: ["deals", "deal-1"] }),
      });
      expect(patchRes.status).toBe(307);
      expect(patchRes.headers.get("Location")).toBe(
        "http://localhost:3000/api/tenant/deals/deal-1",
      );

      const delReq = new NextRequest(
        "http://localhost:3000/api/v2/deals/deal-1",
        { method: "DELETE" },
      );
      const delRes = await DELETE(delReq, {
        params: Promise.resolve({ path: ["deals", "deal-1"] }),
      });
      expect(delRes.status).toBe(307);
      expect(delRes.headers.get("Location")).toBe(
        "http://localhost:3000/api/tenant/deals/deal-1",
      );
    });
  });
});
