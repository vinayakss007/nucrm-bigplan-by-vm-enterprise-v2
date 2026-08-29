import { describe, it, expect, vi } from 'vitest';

interface ExtraDef {
  name: string;
  method: string;
  path: string;
  args: unknown[];
  body?: unknown;
  params?: Record<string, string>;
}

interface ResourceDef {
  cls: string;
  mod: string;
  endpoint: string;
  noUpdate?: true;
  noDelete?: true;
  extras?: ExtraDef[];
}

const ALL: ResourceDef[] = [
  { cls: 'AutomationsResource', mod: 'automations', endpoint: '/automations',
    extras: [
      { name: 'trigger', method: 'POST', path: '/automations/a-1/trigger', args: ['a-1', { foo: 1 }], body: { foo: 1 } },
      { name: 'pause', method: 'POST', path: '/automations/a-1/pause', args: ['a-1'] },
      { name: 'resume', method: 'POST', path: '/automations/a-1/resume', args: ['a-1'] },
    ],
  },
  { cls: 'CompaniesResource', mod: 'companies', endpoint: '/companies' },
  { cls: 'ContractsResource', mod: 'contracts', endpoint: '/contracts',
    extras: [{ name: 'sign', method: 'POST', path: '/contracts/c-1/sign', args: ['c-1'] }],
  },
  { cls: 'DealsResource', mod: 'deals', endpoint: '/deals',
    extras: [{ name: 'moveStage', method: 'PATCH', path: '/deals/d-1/stage', args: ['d-1', 'stage-1'], body: { stageId: 'stage-1' } }],
  },
  { cls: 'DocumentsResource', mod: 'documents', endpoint: '/documents' },
  { cls: 'FormsResource', mod: 'forms', endpoint: '/forms',
    extras: [{ name: 'getSubmissions', method: 'GET', path: '/forms/f-1/submissions', args: ['f-1', { page: 1 }], params: { page: '1' } }],
  },
  { cls: 'InvoicesResource', mod: 'invoices', endpoint: '/invoices',
    extras: [
      { name: 'markPaid', method: 'POST', path: '/invoices/i-1/pay', args: ['i-1', '100', 'card'], body: { amount: '100', method: 'card' } },
      { name: 'send', method: 'POST', path: '/invoices/i-1/send', args: ['i-1'] },
    ],
  },
  { cls: 'LeadsResource', mod: 'leads', endpoint: '/leads',
    extras: [{ name: 'convert', method: 'POST', path: '/leads/l-1/convert', args: ['l-1'] }],
  },
  { cls: 'MeetingsResource', mod: 'meetings', endpoint: '/meetings',
    extras: [{ name: 'cancel', method: 'POST', path: '/meetings/m-1/cancel', args: ['m-1'] }],
  },
  { cls: 'OrdersResource', mod: 'orders', endpoint: '/orders' },
  { cls: 'QuotesResource', mod: 'quotes', endpoint: '/quotes',
    extras: [
      { name: 'accept', method: 'POST', path: '/quotes/q-1/accept', args: ['q-1'] },
      { name: 'reject', method: 'POST', path: '/quotes/q-1/reject', args: ['q-1'] },
    ],
  },
  { cls: 'ReportsResource', mod: 'reports', endpoint: '/reports', noUpdate: true,
    extras: [{ name: 'run', method: 'POST', path: '/reports/r-1/run', args: ['r-1'] }],
  },
  { cls: 'SequencesResource', mod: 'sequences', endpoint: '/sequences',
    extras: [
      { name: 'enroll', method: 'POST', path: '/sequences/s-1/enroll', args: ['s-1', ['c-1', 'c-2']], body: { contactIds: ['c-1', 'c-2'] } },
      { name: 'unenroll', method: 'POST', path: '/sequences/s-1/unenroll', args: ['s-1', ['c-3']], body: { contactIds: ['c-3'] } },
    ],
  },
  { cls: 'ServicesResource', mod: 'services', endpoint: '/services' },
  { cls: 'SubscriptionsResource', mod: 'subscriptions', endpoint: '/subscriptions', noDelete: true,
    extras: [
      { name: 'cancel', method: 'POST', path: '/subscriptions/sub-1/cancel', args: ['sub-1'] },
      { name: 'pause', method: 'POST', path: '/subscriptions/sub-1/pause', args: ['sub-1'] },
      { name: 'resume', method: 'POST', path: '/subscriptions/sub-1/resume', args: ['sub-1'] },
    ],
  },
  { cls: 'TasksResource', mod: 'tasks', endpoint: '/tasks',
    extras: [{ name: 'complete', method: 'POST', path: '/tasks/t-1/complete', args: ['t-1'] }],
  },
  { cls: 'TicketsResource', mod: 'tickets', endpoint: '/tickets',
    extras: [{ name: 'addReply', method: 'POST', path: '/tickets/t-1/reply', args: ['t-1', 'Thanks!'], body: { content: 'Thanks!' } }],
  },
];

describe.each(ALL)('$cls', ({ cls, mod, endpoint, noUpdate, noDelete, extras }) => {
  it('list calls GET with params', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const modExports = await import(`@/lib/sdk/resources/${mod}`);
    const r = new modExports[cls](req);
    await r.list({ page: 1, limit: 25, sort: 'name', order: 'asc', search: 'foo', filters: { status: 'active' } });
    expect(req).toHaveBeenCalledWith('GET', endpoint, undefined, {
      page: '1', limit: '25', sort: 'name', order: 'asc', search: 'foo', filters: '{"status":"active"}',
    });
  });

  it('list passes {} when no options', async () => {
    const req = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const modExports = await import(`@/lib/sdk/resources/${mod}`);
    const r = new modExports[cls](req);
    await r.list();
    expect(req).toHaveBeenCalledWith('GET', endpoint, undefined, {});
  });

  it('get calls GET /:id', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'x-1' });
    const modExports = await import(`@/lib/sdk/resources/${mod}`);
    const r = new modExports[cls](req);
    expect(await r.get('x-1')).toEqual({ id: 'x-1' });
    expect(req).toHaveBeenCalledWith('GET', `${endpoint}/x-1`);
  });

  it('create calls POST with data', async () => {
    const req = vi.fn().mockResolvedValue({ id: 'x-2' });
    const modExports = await import(`@/lib/sdk/resources/${mod}`);
    const r = new modExports[cls](req);
    const data = { name: 'Test' };
    expect(await r.create(data)).toEqual({ id: 'x-2' });
    expect(req).toHaveBeenCalledWith('POST', endpoint, data);
  });

  if (!noUpdate) {
    it('update calls PATCH /:id with data', async () => {
      const req = vi.fn().mockResolvedValue({ id: 'x-1' });
      const modExports = await import(`@/lib/sdk/resources/${mod}`);
      const r = new modExports[cls](req);
      const data = { name: 'Updated' };
      expect(await r.update('x-1', data)).toEqual({ id: 'x-1' });
      expect(req).toHaveBeenCalledWith('PATCH', `${endpoint}/x-1`, data);
    });
  }

  if (!noDelete) {
  it('delete calls DELETE /:id', async () => {
    const req = vi.fn().mockResolvedValue(undefined);
    const modExports = await import(`@/lib/sdk/resources/${mod}`);
    const r = new modExports[cls](req);
    await r.delete('x-1');
    expect(req).toHaveBeenCalledWith('DELETE', `${endpoint}/x-1`);
    });
  }

  if (extras) {
    describe.each(extras)('extra: $name', ({ name, method, path, args, body, params }) => {
      it(`calls ${method} ${path}`, async () => {
        const req = vi.fn().mockResolvedValue(null);
        const modExports = await import(`@/lib/sdk/resources/${mod}`);
        const r = new modExports[cls](req) as Record<string, (...a: unknown[]) => Promise<unknown>>;
        await r[name](...args);
        const expectedArgs = (params !== undefined) ? [method, path, undefined, params]
          : body !== undefined ? [method, path, body]
          : [method, path];
        expect(req).toHaveBeenCalledWith(...expectedArgs);
      });
    });
  }
});
