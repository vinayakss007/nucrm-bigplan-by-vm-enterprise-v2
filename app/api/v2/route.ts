/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from "next/server";
import { withDeprecation, SUNSET_DATE } from "@/lib/api/deprecation";

/**
 * GET /api/v2
 * Versioned API entry point - returns API info, deprecation notice, and available resources.
 *
 * #3504 / PR-7A: /api/v2 is deprecated in favor of direct /api/tenant/* endpoints.
 */
export async function GET(_request: NextRequest) {
  const response = NextResponse.json({
    version: "v2",
    status: "deprecated",
    deprecated: true,
    message:
      "The /api/v2 loopback proxy is deprecated in favor of direct /api/tenant/* endpoints.",
    successor: "/api/tenant",
    resources: [
      "contacts",
      "deals",
      "companies",
      "tasks",
      "activities",
      "pipelines",
      "forms",
      "tickets",
      "invoices",
      "webhooks",
      "api-keys",
      "branding",
    ],
    documentation: "https://docs.nucrm.io/api/v2",
    authentication: {
      methods: ["api_key", "jwt"],
      api_key_prefix: "ak_",
      header: "Authorization: Bearer ak_...",
    },
    rate_limits: "Rate limits vary per endpoint; see documentation.",
  });

  return withDeprecation(response, {
    successor: "/api/tenant",
    message:
      "The /api/v2 loopback proxy is deprecated. Call /api/tenant/* directly.",
    sunset: new Date(`${SUNSET_DATE}T23:59:59Z`),
  });
}
