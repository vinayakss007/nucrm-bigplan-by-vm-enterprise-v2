import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
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

    if (!form || !form.isActive || form.tenantStatus !== 'active') {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: {'Access-Control-Allow-Origin':'*'} });
    }

    return NextResponse.json(
      { 
        id: form.id, 
        name: form.name, 
        fields: form.fields, 
        description: form.description, 
        settings: { success_message: (form.settings as Record<string, unknown>)?.['success_message'] as string ?? 'Thank you!' } 
      },
      { headers: {'Access-Control-Allow-Origin':'*'} }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: {'Access-Control-Allow-Origin':'*'} });
  }
}

export async function OPTIONS() {
  return new Response(null, { headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET'} });
}
