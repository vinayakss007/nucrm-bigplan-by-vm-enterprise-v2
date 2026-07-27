import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, formSubmissions } from '@/drizzle/schema';
import { eq, sql, and, gte } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { readJsonBody } from '@/lib/api/validate';

interface FormField {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface FieldAnalytics {
  key: string;
  label: string;
  type: string;
  total: number;
  filled: number;
  completionRate: number;
  valueDistribution?: { value: string; count: number }[];
  numericStats?: { min: number; max: number; avg: number };
}

export function computeFieldAnalytics(
  fields: FormField[],
  submissionsData: Record<string, unknown>[],
): FieldAnalytics[] {
  const total = submissionsData.length;
  return fields.map((field) => {
    const filled = submissionsData.filter((s) => {
      const val = s[field.key];
      if (val === null || val === undefined || val === '') return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;
    }).length;

    const completionRate = total > 0 ? Math.round((filled / total) * 100) : 0;

    const isOptionField = ['select', 'radio', 'multiselect'].includes(field.type);
    const isNumeric = field.type === 'number';

    let valueDistribution: { value: string; count: number }[] | undefined;
    let numericStats: { min: number; max: number; avg: number } | undefined;

    if (isOptionField && field.options) {
      const counts: Record<string, number> = {};
      field.options.forEach((opt) => { counts[opt] = 0; });
      submissionsData.forEach((s) => {
        const val = s[field.key];
        if (val !== null && val !== undefined && val !== '') {
          const values = Array.isArray(val) ? val : [val];
          values.forEach((v: string) => {
            if (counts[v] !== undefined) counts[v]++;
            else counts[v] = 1;
          });
        }
      });
      valueDistribution = Object.entries(counts).map(([value, count]) => ({ value, count }));
    } else if (isNumeric) {
      const nums = submissionsData
        .map((s) => s[field.key])
        .filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
        .map(Number);
      if (nums.length > 0) {
        numericStats = {
          min: Math.min(...nums),
          max: Math.max(...nums),
          avg: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100,
        };
      }
    }

    return { key: field.key, label: field.label, type: field.type, total, filled, completionRate, valueDistribution, numericStats };
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const form = await db.query.forms.findFirst({
      where: eq(forms.id, id),
      columns: { viewsCount: true, submissionsCount: true, name: true, fields: true },
    });
    if (!form) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const daysParam = req.nextUrl.searchParams.get('days') || '30';
    const days = Math.min(Math.max(parseInt(daysParam, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000);

    const [timeSeries, submissionsData] = await Promise.all([
      db
        .select({
          date: sql<string>`to_char(${formSubmissions.createdAt}::date, 'YYYY-MM-DD')`,
          count: sql<number>`count(*)::int`,
        })
        .from(formSubmissions)
        .where(and(eq(formSubmissions.formId, id), gte(formSubmissions.createdAt, since)))
        .groupBy(sql`${formSubmissions.createdAt}::date`)
        .orderBy(sql`${formSubmissions.createdAt}::date`),
      db
        .select({ data: formSubmissions.data })
        .from(formSubmissions)
        .where(and(eq(formSubmissions.formId, id), gte(formSubmissions.createdAt, since))),
    ]);

    const fields = (form.fields as FormField[]) ?? [];
    const rawData = submissionsData.map((s) => (s.data ?? {}) as Record<string, unknown>);
    const fieldAnalytics = computeFieldAnalytics(fields, rawData);

    return NextResponse.json({
      name: form.name,
      views: form.viewsCount ?? 0,
      submissions: form.submissionsCount ?? 0,
      timeSeries,
      fields: fieldAnalytics,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body: { type?: string } = {};
    try {
      body = await readJsonBody(req);
    } catch {}

    if (body.type === 'submit') {
      await db
        .update(forms)
        .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
        .where(eq(forms.id, id));
    } else {
      await db
        .update(forms)
        .set({ viewsCount: sql`${forms.viewsCount} + 1` })
        .where(eq(forms.id, id));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
