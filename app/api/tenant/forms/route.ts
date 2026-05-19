import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { forms } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'forms-builder');
    if (modErr) return modErr;

    const allForms = await db.query.forms.findMany({
        limit: 200,
      where: and(eq(forms.tenantId, ctx.tenantId), sql`${forms.deletedAt} IS NULL`),
      orderBy: [desc(forms.createdAt)]
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const formsWithEmbed = allForms.map((f: any) => ({
      ...f,
      embed_code: `<iframe src="${appUrl}/lead-capture?form=${f.slug}" 
  style="width:100%;min-height:500px;border:none;border-radius:8px;" 
  title="${f.name}" loading="lazy" allow="clipboard-write"></iframe>
<!-- Powered by abetworks.in — NuCRM -->`,
      public_url: `${appUrl}/lead-capture?form=${f.slug}`
    }));

    return NextResponse.json({ data: formsWithEmbed });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'forms-builder');
    if (modErr) return modErr;

    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { name, description, fields = [], settings = {} } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,40) + '-' + Date.now().toString(36);
    
    const [newForm] = await db.insert(forms)
      .values({
        tenantId: ctx.tenantId,
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        fields: fields,
        settings: settings,
        createdBy: ctx.userId
      })
      .returning();

    // Generate embed code with abetworks branding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const embedCode = `<iframe src="${appUrl}/lead-capture?form=${slug}" 
  style="width:100%;min-height:500px;border:none;border-radius:8px;" 
  title="${name.trim()}" loading="lazy"
  allow="clipboard-write"></iframe>
<!-- Powered by abetworks.in — NuCRM -->`;

    return NextResponse.json({ 
      data: { ...newForm, embed_code: embedCode, public_url: `${appUrl}/lead-capture?form=${slug}` }
    }, { status: 201 });
  } catch (err: any) {
    return apiError(err);
  }
}
