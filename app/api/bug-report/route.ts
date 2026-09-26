/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { withApiRoute } from '@/lib/api/with-api-route';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { z } from 'zod';

/**
 * Beta "Report a bug" sink. Nothing is persisted in our database: the report
 * is forwarded straight out of the process to wherever the operator collects
 * feedback, configured entirely by env:
 *
 *   GITHUB_ISSUES_TOKEN + GITHUB_ISSUES_REPO=owner/repo
 *     → files a GitHub issue (recommended — same place we triage everything).
 *   BUG_REPORT_ENDPOINT=https://... (Discord/Slack/Tally/n8n/anything JSON)
 *     → POSTs the report JSON, with optional BUG_REPORT_ENDPOINT_TOKEN bearer.
 *
 * Neither set → 503 "not configured", so the button can't silently drop data.
 */
export const bugReportSchema = z.object({
  title: z.string().trim().min(5, 'Give the bug a short title (5+ characters)').max(200),
  description: z.string().trim().min(10, 'Describe what happened (10+ characters)').max(5000),
  severity: z.enum(['cosmetic', 'minor', 'major', 'blocker']).default('minor'),
  pageUrl: z.string().max(2000).optional(),
  expected: z.string().trim().max(2000).optional(),
  actual: z.string().trim().max(2000).optional(),
});

const FETCH_TIMEOUT_MS = 8_000;

// Discord/Slack webhooks only understand their own message shapes; anything
// else gets the structured JSON so it can be routed wherever the operator likes.
export function formatWebhookPayload(
  webhookUrl: string,
  report: z.infer<typeof bugReportSchema>,
  meta: { email: string; tenantId: string; userAgent: string },
): unknown {
  const reportedAt = new Date().toISOString();
  const md = [
    `**${report.severity.toUpperCase()} — ${report.title}**`,
    report.description,
    `Page: ${report.pageUrl || '(unknown)'}`,
    `Reporter: ${meta.email} · tenant \`${meta.tenantId}\``,
    `Browser: ${meta.userAgent}`,
    reportedAt,
  ].join('\n\n');

  if (/discord(app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
    return { content: md.slice(0, 1990) }; // Discord content limit is 2000 chars
  }
  if (/hooks\.slack\.com|slack\.com\/services\/T/.test(webhookUrl)) {
    return { text: md };
  }
  return {
    kind: 'nucrm-beta-bug-report',
    ...report,
    reporter: { email: meta.email, tenantId: meta.tenantId },
    userAgent: meta.userAgent,
    reportedAt,
  };
}

async function postJson(url: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data?: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'nucrm-bug-report-button',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => undefined) : undefined;
  return { ok: res.ok, status: res.status, data };
}

async function fileGitHubIssue(
  repo: string,
  token: string,
  report: z.infer<typeof bugReportSchema>,
  meta: { email: string; tenantId: string; userAgent: string },
): Promise<{ url?: string }> {
  const body = [
    `**Severity:** ${report.severity}`,
    `**Page:** ${report.pageUrl || '(unknown)'}`,
    `**Reporter:** ${meta.email} · tenant \`${meta.tenantId}\``,
    `**Browser:** ${meta.userAgent}`,
    '',
    '## What happened',
    report.description,
    ...(report.expected ? ['', '## Expected', report.expected] : []),
    ...(report.actual ? ['', '## Actual', report.actual] : []),
    '',
    '_Filed from the in-app beta bug-report button._',
  ].join('\n');

  const result = await postJson(
    `https://api.github.com/repos/${repo}/issues`,
    { title: `[beta] ${report.title}`, body, labels: ['beta-feedback'] },
    token,
  );
  if (!result.ok) {
    throw Object.assign(new Error(`GitHub issue creation failed (HTTP ${result.status})`), { upstreamStatus: result.status });
  }
  const htmlUrl = (result.data as { html_url?: string } | undefined)?.html_url;
  return { url: htmlUrl };
}

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const raw = await readJsonBody(request);
    const validated = validateBody(bugReportSchema, raw);
    if (validated instanceof NextResponse) return validated;
    const report = validated.data;

    const meta = {
      email: ctx.user?.email ?? '(anonymous)',
      tenantId: ctx.tenantId,
      userAgent: request.headers.get('user-agent') ?? '(unknown)',
    };

    const ghToken = process.env.GITHUB_ISSUES_TOKEN;
    const ghRepo = process.env.GITHUB_ISSUES_REPO;
    const webhook = process.env.BUG_REPORT_ENDPOINT;

    if (ghToken && ghRepo) {
      const { url } = await fileGitHubIssue(ghRepo, ghToken, report, meta);
      return NextResponse.json({ ok: true, sink: 'github', url });
    }
    if (webhook) {
      const result = await postJson(webhook, formatWebhookPayload(webhook, report, meta), process.env.BUG_REPORT_ENDPOINT_TOKEN);
      if (!result.ok) {
        return NextResponse.json(
          { error: 'The feedback endpoint rejected the report — please retry or tell us directly.' },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, sink: 'webhook' });
    }

    return NextResponse.json(
      { error: 'Bug reporting is not configured on this deployment yet.' },
      { status: 503 },
    );
  } catch (err) {
    if (err instanceof Error && 'upstreamStatus' in err) {
      return NextResponse.json(
        { error: 'Could not file the report upstream — the team has been notified to check configuration.' },
        { status: 502 },
      );
    }
    return apiError(err);
  }
});
