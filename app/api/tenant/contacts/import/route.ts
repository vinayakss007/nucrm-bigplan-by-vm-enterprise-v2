/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { withApiRoute } from '@/lib/api/with-api-route';
// #H1: import logic now lives in a shared module so the sync route AND the
// async contact-import queue worker run the exact same, tenant-scoped path.
import { parseContactsCsv, processContactImport, MAX_IMPORT_ROWS } from '@/lib/import/contacts';
import { enforceFieldWrite } from '@/lib/rbac/enforce';

// #2618 — CONTACT_COLUMN_MAP emits camelCase props; field_permissions speaks
// snake_case column names. Normalize → enforceFieldWrite → normalize back.
async function contactRowGate(
  ctx: AuthContext,
  mapped: Record<string, unknown>,
): Promise<{ kept: Record<string, unknown>; dropped: string[] }> {
  const toSnake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const { body, stripped } = await enforceFieldWrite(
    ctx, 'contacts', Object.fromEntries(Object.entries(mapped).map(([k, v]) => [toSnake(k), v])),
  );
  return {
    kept: Object.fromEntries(Object.entries(body).map(([k, v]) => [toCamel(k), v])),
    dropped: stripped,
  };
}

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await checkRateLimit(request, { action:'csv_import', max:10, windowMinutes:60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.import');
    if (deny) return deny;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(importSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const _v = validated.data;
    const { csv, skipDuplicates = true, updateExisting = false } = { ...rawBody, csv: rawBody.csv };
    if (!csv) return NextResponse.json({ error:'csv field required' }, { status:400 });

    const rows = parseContactsCsv(csv);
    if (!rows.length) return NextResponse.json({ error:'No data rows found in CSV' }, { status:400 });
    if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error:`CSV too large (max ${MAX_IMPORT_ROWS.toLocaleString()} rows)` }, { status:400 });

    const results = await processContactImport(ctx.tenantId, ctx.userId, rows, {
      skipDuplicates,
      updateExisting,
      fieldGate: (mapped) => contactRowGate(ctx, mapped),
    });

    // Audit log
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contacts.imported',
      entityType: 'contact',
      newData: { imported: results.imported, updated: results.updated, skipped: results.skipped, errors: results.errors.length },
    });

    return NextResponse.json({ ok:true, results });
 
 
  } catch (err) {
    await logError({ error: err, context: 'tenant/contacts import POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
