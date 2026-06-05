import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { getFieldPermissions, setFieldPermission } from '@/lib/rbac/field-permissions';
import type { FieldAccessLevel } from '@/lib/rbac/field-permissions';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const setPermissionSchema = z.object({
  role_id: z.string().uuid(),
  entity_type: z.string().min(1).max(100),
  field_name: z.string().min(1).max(100),
  access_level: z.enum(['none', 'read', 'write', 'admin']),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const roleId = searchParams.get('role_id');
    const entityType = searchParams.get('entity_type');

    if (!roleId || !entityType) {
      return NextResponse.json(
        { error: 'role_id and entity_type query params required' },
        { status: 400 }
      );
    }

    const permissions = await getFieldPermissions(ctx.tenantId, roleId, entityType);

    return NextResponse.json({ data: permissions });
  } catch (err: unknown) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(setPermissionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const result = await setFieldPermission(
      ctx.tenantId,
      v.role_id,
      v.entity_type,
      v.field_name,
      v.access_level as FieldAccessLevel
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err: unknown) { return apiError(err); }
}
