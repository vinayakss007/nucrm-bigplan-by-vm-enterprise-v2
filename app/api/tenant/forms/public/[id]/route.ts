/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { isEntityId } from '@/lib/id';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isEntityId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [form] = await db
      .select({
        id: forms.id,
        name: forms.name,
        fields: forms.fields,
        description: forms.description,
        settings: forms.settings,
        isActive: forms.isActive,
        tenantStatus: tenants.status
      })
      .from(forms)
      .innerJoin(tenants, eq(tenants.id, forms.tenantId))
      .where(eq(forms.id, id))
      .limit(1);

    // #2119: distinguish "form gone/unpublished" (404) from "tenant not
    // active" (403 + machine-readable code) so visitors get a truthful
    // message and support has a signal instead of a silent 404.
    if (!form || !form.isActive) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (form.tenantStatus !== 'active') {
      return NextResponse.json(
        { error: 'This form is temporarily unavailable', code: 'TENANT_NOT_ACTIVE' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      id: form.id,
      name: form.name,
      fields: form.fields,
      description: form.description,
      settings: { success_message: (form.settings as Record<string, unknown>)?.success_message as string ?? 'Thank you!' }
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { headers: { 'Access-Control-Allow-Methods': 'GET' } });
}
