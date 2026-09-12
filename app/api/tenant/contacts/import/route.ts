/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { importSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { checkRateLimit } from '@/lib/rate-limit';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { withApiRoute } from '@/lib/api/with-api-route';
// #H1: import logic now lives in a shared module so the sync route AND the
// async contact-import queue worker run the exact same, tenant-scoped path.
import { parseContactsCsv, processContactImport, MAX_IMPORT_ROWS } from '@/lib/import/contacts';

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

    const results = await processContactImport(ctx.tenantId, ctx.userId, rows, { skipDuplicates, updateExisting });

    // Audit log
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'contacts.imported',
      entityType: 'contact',
      newData: { imported: results.imported, updated: results.updated, skipped: results.skipped, errors: results.errors.length },
    });

    return NextResponse.json({ ok:true, results });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    await logError({ error: err, context: 'tenant/contacts import POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
