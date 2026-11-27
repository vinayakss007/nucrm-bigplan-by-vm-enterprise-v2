import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const lookups = vi.hoisted(() => ({
  row: null as { tenantId: string; isActive: boolean; tenantStatus: string } | null,
  ids: [] as string[],
}));

vi.mock('@/lib/db/form-capture-context', () => ({
  withFormLookupContext: vi.fn(async (id: string, fn: (tx: unknown) => Promise<unknown>) => {
    lookups.ids.push(id);
    const chain = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: async () => (lookups.row ? [lookups.row] : []),
    };
    return fn(chain);
  }),
}));

vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

type TreeNode = {
  type?: unknown;
  props?: { children?: ReactNode; href?: unknown; tenantId?: unknown; formId?: unknown };
};

function flatten(node: ReactNode, out: TreeNode[] = []): TreeNode[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
  } else if (node && typeof node === 'object') {
    const element = node as TreeNode;
    out.push(element);
    if (element.props?.children) flatten(element.props.children, out);
  }
  return out;
}

async function renderPage(searchParams: { form?: string | string[] } = {}, marketingTenantId = '') {
  vi.stubEnv('NEXT_PUBLIC_MARKETING_TENANT_ID', marketingTenantId);
  vi.resetModules();
  const [{ default: LeadCapturePage }, { default: SimpleLeadForm }] = await Promise.all([
    import('@/app/lead-capture/page'),
    import('@/components/shared/simple-lead-form'),
  ]);
  const tree = await LeadCapturePage({ searchParams: Promise.resolve(searchParams) });
  return { nodes: flatten(tree), SimpleLeadForm };
}

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const FORM_ID = '30000000-0000-4000-8000-000000000001';

describe('lead capture failproof (PP-065)', () => {
  beforeEach(() => {
    lookups.row = null;
    lookups.ids.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('shows the direct-email fallback when no receiving tenant is configured', async () => {
    const { nodes, SimpleLeadForm } = await renderPage();
    expect(nodes.some((n) => n.type === SimpleLeadForm)).toBe(false);
    expect(nodes.some((n) => typeof n.props?.href === 'string' && n.props.href.startsWith('mailto:'))).toBe(true);
  });

  it('passes the configured marketing tenant into the form', async () => {
    const { nodes, SimpleLeadForm } = await renderPage({}, TENANT_ID);
    const form = nodes.find((n) => n.type === SimpleLeadForm);
    expect(form?.props?.tenantId).toBe(TENANT_ID);
    expect(form?.props?.formId).toBeUndefined();
  });

  it('routes an embedded form to its owning tenant and carries form_id', async () => {
    lookups.row = { tenantId: TENANT_ID, isActive: true, tenantStatus: 'active' };
    const { nodes, SimpleLeadForm } = await renderPage({ form: FORM_ID }, '20000000-0000-4000-8000-000000000002');
    expect(lookups.ids).toEqual([FORM_ID]);
    const form = nodes.find((n) => n.type === SimpleLeadForm);
    expect(form?.props?.tenantId).toBe(TENANT_ID);
    expect(form?.props?.formId).toBe(FORM_ID);
  });

  it('never misroutes an embedded form whose owner cannot be resolved', async () => {
    lookups.row = { tenantId: TENANT_ID, isActive: false, tenantStatus: 'active' };
    const { nodes, SimpleLeadForm } = await renderPage({ form: FORM_ID }, TENANT_ID);
    expect(nodes.some((n) => n.type === SimpleLeadForm)).toBe(false);
    expect(nodes.some((n) => typeof n.props?.href === 'string' && n.props.href.startsWith('mailto:'))).toBe(false);
  });

  it('rejects a non-uuid form parameter without touching the database', async () => {
    const { nodes, SimpleLeadForm } = await renderPage({ form: 'some-form-slug' }, TENANT_ID);
    expect(lookups.ids).toEqual([]);
    expect(nodes.some((n) => n.type === SimpleLeadForm)).toBe(false);
  });
});
