import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { ModuleRegistry } from '@/lib/modules/registry';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const installed = await ModuleRegistry.getTenantModules(ctx.tenantId);
    const all = ModuleRegistry.getAll();
    // Merge: mark each module as installed/active/available
    const merged = all.map(m => {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inst = installed.find((i: any) => i.module_id === m.id);
      return { ...m, status: inst?.status ?? 'available', settings: inst?.settings ?? {}, installed_at: inst?.installed_at ?? null };
    });
    return NextResponse.json({ data: merged });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { module_id, settings = {} } = await req.json();
    if (!module_id) return NextResponse.json({ error: 'module_id required' }, { status: 400 });
    const result = await ModuleRegistry.install(ctx.tenantId, module_id, ctx.userId, settings);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { module_id, action, settings } = await req.json();
    if (!module_id) return NextResponse.json({ error: 'module_id required' }, { status: 400 });
    if (action === 'disable') await ModuleRegistry.disable(ctx.tenantId, module_id);
    else if (action === 'update_settings' && settings) await ModuleRegistry.updateSettings(ctx.tenantId, module_id, settings);
    else if (action === 'enable') await ModuleRegistry.install(ctx.tenantId, module_id, ctx.userId, settings ?? {});
    else return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
