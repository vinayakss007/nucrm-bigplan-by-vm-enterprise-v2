import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Rows the mocked `db.select().from().where()` chain resolves with. Driving the
 * mock from a plain array rather than parsing Drizzle's SQL chunks keeps these
 * tests independent of ORM internals.
 */
let selectRows: Record<string, unknown>[] = [];

vi.mock('@/drizzle/db', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => selectRows) })),
    })),
  };
  return { db };
});

import { getTableColumns } from 'drizzle-orm';
import { contacts, companies, leads, deals } from '@/drizzle/schema/crm';
import { tasks } from '@/drizzle/schema/tasks';

import {
  NATIVE_TARGETS,
  ENTITIES_WITH_CUSTOM_FIELDS,
  MAPPABLE_ENTITIES,
  VALID_TRANSFORMS,
  isValidNativeTarget,
  applyTransform,
  applyFieldMappings,
  loadFieldMappings,
  REJECT_NATIVE_NOT_ALLOWED,
  REJECT_NO_CUSTOM_FIELDS,
  REJECT_ALREADY_PROVIDED,
  type FieldMapping,
} from '@/lib/webhooks/field-mapping';

const TENANT = '11111111-1111-1111-1111-111111111111';
const API_KEY = '22222222-2222-2222-2222-222222222222';

/**
 * Entity name -> Drizzle table, mirroring ENTITY_TABLES inside the engine. Used
 * to derive custom-field expectations from the schema instead of hardcoding
 * entity names that a later migration would invalidate.
 */
const ENTITY_TABLES: Record<string, Parameters<typeof getTableColumns>[0]> = {
  contact: contacts,
  lead: leads,
  deal: deals,
  company: companies,
  task: tasks,
};

/** Columns no mapping may ever write, whatever a tenant admin configures. */
const FORBIDDEN_TARGETS = [
  'id', 'tenantId', 'createdBy', 'updatedBy', 'deletedAt', 'isArchived', 'ownerId', 'stageId',
];

function mapping(over: Partial<FieldMapping> = {}): FieldMapping {
  return {
    sourceKey: 'call_duration',
    targetType: 'custom_field',
    targetKey: 'call_duration',
    transform: null,
    isActive: true,
    apiKeyId: null,
    ...over,
  };
}

describe('NATIVE_TARGETS security boundary', () => {
  it('covers every entity the inbound route dispatches to', () => {
    expect(Object.keys(NATIVE_TARGETS).sort()).toEqual([...MAPPABLE_ENTITIES].sort());
  });

  // The regression test that matters: a mapping target is attacker-influenced
  // config, so a dangerous column slipping into the allowlist is a cross-tenant
  // write or a privilege escalation, not a cosmetic bug.
  for (const entity of ['contact', 'lead', 'deal', 'company', 'task']) {
    it(`excludes every dangerous column for ${entity}`, () => {
      const allowed = NATIVE_TARGETS[entity]!;
      for (const forbidden of FORBIDDEN_TARGETS) {
        expect(allowed, `${entity} must not allow ${forbidden}`).not.toContain(forbidden);
      }
    });
  }

  it('never allows customFields as a native target', () => {
    // Reachable through targetType 'custom_field'; as a native target one key
    // could replace the whole blob.
    for (const entity of MAPPABLE_ENTITIES) {
      expect(NATIVE_TARGETS[entity]).not.toContain('customFields');
    }
  });

  it('lists only keys the corresponding handler already consumes', () => {
    expect(NATIVE_TARGETS['contact']).toEqual([
      'firstName', 'lastName', 'email', 'phone', 'companyId', 'assignedTo',
      'leadStatus', 'leadSource', 'notes', 'tags', 'score', 'city', 'country',
      'website', 'linkedinUrl', 'twitterUrl',
    ]);
    expect(NATIVE_TARGETS['lead']).toEqual([
      'firstName', 'lastName', 'email', 'phone', 'mobile', 'title', 'companyName',
      'leadSource', 'leadStatus', 'lifecycleStage', 'assignedTo', 'tags', 'notes',
    ]);
    expect(NATIVE_TARGETS['deal']).toEqual([
      'title', 'value', 'stage', 'probability', 'closeDate', 'contactId',
      'companyId', 'assignedTo', 'notes',
    ]);
    expect(NATIVE_TARGETS['company']).toEqual([
      'name', 'industry', 'size', 'website', 'phone', 'address', 'notes',
    ]);
    expect(NATIVE_TARGETS['task']).toEqual([
      'title', 'description', 'dueDate', 'priority', 'contactId', 'dealId',
      'assignedTo', 'completed',
    ]);
  });

  it('reflects which entities actually have a custom_fields column', () => {
    // Derived from the Drizzle schema at module load, so this expectation is
    // derived the same way rather than pinning entity names. Hardcoding the list
    // would make this test fail every time an entity gains or loses the column,
    // which is a schema decision this test has no business constraining.
    const expected = Object.entries(ENTITY_TABLES)
      .filter(([, table]) => 'customFields' in getTableColumns(table))
      .map(([entity]) => entity)
      .sort();

    expect([...ENTITIES_WITH_CUSTOM_FIELDS].sort()).toEqual(expected);
  });

  it('excludes an entity whose table has no customFields column', () => {
    // The real assertion behind the derivation: a table without the column must
    // not appear. Catches a mis-derivation such as probing for the snake_case
    // 'custom_fields' key, which would silently match nothing and yield an empty
    // set that the derived test above would happily agree with.
    for (const [entity, table] of Object.entries(ENTITY_TABLES)) {
      const hasColumn = 'customFields' in getTableColumns(table);
      expect(ENTITIES_WITH_CUSTOM_FIELDS.has(entity), entity).toBe(hasColumn);
    }
  });

  it('resolves to a non-empty set, so custom-field mapping is reachable', () => {
    // Guards the failure mode where the derivation breaks entirely and every
    // custom-field mapping starts getting rejected.
    expect(ENTITIES_WITH_CUSTOM_FIELDS.size).toBeGreaterThan(0);
  });
});

describe('isValidNativeTarget', () => {
  it('accepts a real allowlisted field for each entity', () => {
    expect(isValidNativeTarget('contact', 'leadSource')).toBe(true);
    expect(isValidNativeTarget('lead', 'lifecycleStage')).toBe(true);
    expect(isValidNativeTarget('deal', 'probability')).toBe(true);
    expect(isValidNativeTarget('company', 'industry')).toBe(true);
    expect(isValidNativeTarget('task', 'dueDate')).toBe(true);
  });

  it('rejects tenantId for every entity', () => {
    for (const entity of MAPPABLE_ENTITIES) {
      expect(isValidNativeTarget(entity, 'tenantId')).toBe(false);
    }
  });

  it('rejects id and createdBy', () => {
    expect(isValidNativeTarget('contact', 'id')).toBe(false);
    expect(isValidNativeTarget('contact', 'createdBy')).toBe(false);
    expect(isValidNativeTarget('lead', 'ownerId')).toBe(false);
    expect(isValidNativeTarget('deal', 'stageId')).toBe(false);
  });

  it('rejects an unknown entity even for a name allowlisted elsewhere', () => {
    expect(isValidNativeTarget('invoice', 'notes')).toBe(false);
    expect(isValidNativeTarget('', 'notes')).toBe(false);
  });

  it('does not resolve inherited Object.prototype keys as entities', () => {
    expect(isValidNativeTarget('constructor', 'notes')).toBe(false);
    expect(isValidNativeTarget('__proto__', 'notes')).toBe(false);
  });

  it('rejects an empty target key', () => {
    expect(isValidNativeTarget('contact', '')).toBe(false);
  });
});

describe('applyTransform', () => {
  it("'string' coerces via String()", () => {
    expect(applyTransform(42, 'string')).toBe('42');
    expect(applyTransform(true, 'string')).toBe('true');
  });

  it("'number' parses numeric strings and passes finite numbers through", () => {
    expect(applyTransform('42', 'number')).toBe(42);
    expect(applyTransform(' 3.5 ', 'number')).toBe(3.5);
    expect(applyTransform(7, 'number')).toBe(7);
  });

  it("'number' on a non-numeric string yields null", () => {
    expect(applyTransform('ninety seconds', 'number')).toBeNull();
    expect(applyTransform('', 'number')).toBeNull();
    expect(applyTransform(Infinity, 'number')).toBeNull();
    expect(applyTransform({ a: 1 }, 'number')).toBeNull();
  });

  it("'boolean' treats 'true', '1' and 'yes' as true, case-insensitively", () => {
    for (const truthy of ['true', 'TRUE', '1', 'yes', 'YES', ' Yes ']) {
      expect(applyTransform(truthy, 'boolean'), truthy).toBe(true);
    }
    expect(applyTransform(true, 'boolean')).toBe(true);
    expect(applyTransform(1, 'boolean')).toBe(true);
  });

  it("'boolean' treats anything else as false", () => {
    expect(applyTransform('no', 'boolean')).toBe(false);
    expect(applyTransform('0', 'boolean')).toBe(false);
    expect(applyTransform(false, 'boolean')).toBe(false);
    expect(applyTransform(0, 'boolean')).toBe(false);
    expect(applyTransform(null, 'boolean')).toBe(false);
  });

  it("'date' produces a Date for a parseable value", () => {
    const result = applyTransform('2026-05-28T10:00:00Z', 'date');
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2026-05-28T10:00:00.000Z');
  });

  it("'date' on an invalid date yields null", () => {
    expect(applyTransform('not-a-date', 'date')).toBeNull();
    expect(applyTransform(new Date('nope'), 'date')).toBeNull();
    expect(applyTransform({}, 'date')).toBeNull();
  });

  it("'trim' trims strings", () => {
    expect(applyTransform('  hello  ', 'trim')).toBe('hello');
  });

  it("'trim' passes a non-string through untouched", () => {
    const obj = { a: 1 };
    expect(applyTransform(obj, 'trim')).toBe(obj);
    expect(applyTransform(42, 'trim')).toBe(42);
  });

  it("'lowercase' lowercases strings", () => {
    expect(applyTransform('HELLO@Example.COM', 'lowercase')).toBe('hello@example.com');
  });

  it("'lowercase' passes a non-string through untouched", () => {
    expect(applyTransform(42, 'lowercase')).toBe(42);
    expect(applyTransform(null, 'lowercase')).toBeNull();
  });

  it('returns the value unchanged for null, undefined or an unknown transform', () => {
    expect(applyTransform('  keep  ', null)).toBe('  keep  ');
    expect(applyTransform('  keep  ', undefined)).toBe('  keep  ');
    expect(applyTransform('  keep  ', 'rot13')).toBe('  keep  ');
  });

  it('exposes exactly the six documented transforms', () => {
    expect([...VALID_TRANSFORMS]).toEqual(['string', 'number', 'boolean', 'date', 'trim', 'lowercase']);
  });
});

describe('applyFieldMappings', () => {
  it('maps a custom-field target into customFields', () => {
    const result = applyFieldMappings('contact', { call_duration: 95 }, [mapping()]);

    expect(result.data.customFields).toEqual({ call_duration: 95 });
    expect(result.applied).toEqual([
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'call_duration' },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('maps a native target at the top level', () => {
    const result = applyFieldMappings('contact', { origin: 'inbound-call' }, [
      mapping({ sourceKey: 'origin', targetType: 'native', targetKey: 'leadSource' }),
    ]);

    expect(result.data.leadSource).toBe('inbound-call');
    expect(result.data.customFields).toBeUndefined();
    expect(result.applied).toEqual([
      { sourceKey: 'origin', targetType: 'native', targetKey: 'leadSource' },
    ]);
  });

  it('preserves customFields the caller already sent', () => {
    const result = applyFieldMappings(
      'contact',
      { customFields: { existing: 'kept' }, call_duration: 95 },
      [mapping()]
    );

    expect(result.data.customFields).toEqual({ existing: 'kept', call_duration: 95 });
  });

  it('does not mutate the input object', () => {
    const input = { call_duration: 95, customFields: { existing: 'kept' } };
    const snapshot = JSON.parse(JSON.stringify(input));

    const result = applyFieldMappings('contact', input, [mapping()]);

    expect(input).toEqual(snapshot);
    expect(input.customFields).toEqual({ existing: 'kept' });
    expect(result.data).not.toBe(input);
    expect(result.data.customFields).not.toBe(input.customFields);
  });

  it('resolves a snake_case source key against a camelCase payload', () => {
    const result = applyFieldMappings('contact', { callDuration: 95 }, [
      mapping({ sourceKey: 'call_duration', targetKey: 'call_duration' }),
    ]);

    expect(result.data.customFields).toEqual({ call_duration: 95 });
    expect(result.applied).toHaveLength(1);
  });

  it('resolves a camelCase source key against a snake_case payload', () => {
    const result = applyFieldMappings('contact', { call_duration: 95 }, [
      mapping({ sourceKey: 'callDuration', targetKey: 'duration' }),
    ]);

    expect(result.data.customFields).toEqual({ duration: 95 });
    expect(result.applied[0]!.sourceKey).toBe('callDuration');
  });

  it('skips inactive mappings', () => {
    const result = applyFieldMappings('contact', { call_duration: 95 }, [
      mapping({ isActive: false }),
    ]);

    expect(result.data.customFields).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('skips a source key absent from the payload without recording an error', () => {
    const result = applyFieldMappings('contact', { email: 'a@b.com' }, [mapping()]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.data).toEqual({ email: 'a@b.com' });
  });

  it('rejects a disallowed native target with the documented reason', () => {
    const result = applyFieldMappings('contact', { evil: 'other-tenant' }, [
      mapping({ sourceKey: 'evil', targetType: 'native', targetKey: 'tenantId' }),
    ]);

    expect(result.data.tenantId).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([
      { sourceKey: 'evil', targetKey: 'tenantId', reason: REJECT_NATIVE_NOT_ALLOWED },
    ]);
    expect(REJECT_NATIVE_NOT_ALLOWED).toBe('native target not allowed');
  });

  it('rejects every dangerous native target, one by one', () => {
    for (const forbidden of FORBIDDEN_TARGETS) {
      const result = applyFieldMappings('lead', { evil: 'x' }, [
        mapping({ sourceKey: 'evil', targetType: 'native', targetKey: forbidden }),
      ]);
      expect(result.data[forbidden], forbidden).toBeUndefined();
      expect(result.rejected[0]!.reason).toBe(REJECT_NATIVE_NOT_ALLOWED);
    }
  });

  it('rejects a custom-field mapping for an entity without the column', () => {
    // Pick the subject from the schema rather than naming an entity. Hardcoding
    // 'task' here meant this test asserted the opposite of the truth as soon as
    // `tasks` gained a custom_fields column. When every real entity supports
    // custom fields, a name outside the set still exercises the same guard.
    const unsupported =
      Object.keys(ENTITY_TABLES).find((entity) => !ENTITIES_WITH_CUSTOM_FIELDS.has(entity))
      ?? 'entity_without_custom_fields';

    const result = applyFieldMappings(unsupported, { call_duration: 95 }, [mapping()]);

    expect(result.data.customFields).toBeUndefined();
    expect(result.rejected).toEqual([
      { sourceKey: 'call_duration', targetKey: 'call_duration', reason: REJECT_NO_CUSTOM_FIELDS },
    ]);
    expect(REJECT_NO_CUSTOM_FIELDS).toBe('entity does not support custom fields');
  });

  it('maps a native target regardless of custom-field support', () => {
    // Native mapping does not depend on a custom_fields column, so this holds
    // whether or not `task` has one. The previous title claimed `task` lacked
    // custom fields, which stopped being true.
    const result = applyFieldMappings('task', { subject: 'Call back' }, [
      mapping({ sourceKey: 'subject', targetType: 'native', targetKey: 'title' }),
    ]);

    expect(result.data.title).toBe('Call back');
    expect(result.rejected).toEqual([]);
  });

  it('refuses to overwrite a native value the caller supplied', () => {
    const result = applyFieldMappings('contact', { origin: 'call', leadSource: 'caller-wins' }, [
      mapping({ sourceKey: 'origin', targetType: 'native', targetKey: 'leadSource' }),
    ]);

    expect(result.data.leadSource).toBe('caller-wins');
    expect(result.rejected).toEqual([
      { sourceKey: 'origin', targetKey: 'leadSource', reason: REJECT_ALREADY_PROVIDED },
    ]);
    expect(REJECT_ALREADY_PROVIDED).toBe('target already provided by caller');
  });

  it('refuses to overwrite a native value the caller supplied in snake_case', () => {
    const result = applyFieldMappings('contact', { origin: 'call', lead_source: 'caller-wins' }, [
      mapping({ sourceKey: 'origin', targetType: 'native', targetKey: 'leadSource' }),
    ]);

    expect(result.data.leadSource).toBeUndefined();
    expect(result.data.lead_source).toBe('caller-wins');
    expect(result.rejected[0]!.reason).toBe(REJECT_ALREADY_PROVIDED);
  });

  it('refuses to overwrite a custom field the caller supplied', () => {
    const result = applyFieldMappings(
      'contact',
      { call_duration: 95, customFields: { call_duration: 'caller-wins' } },
      [mapping()]
    );

    expect((result.data.customFields as Record<string, unknown>).call_duration).toBe('caller-wins');
    expect(result.rejected).toEqual([
      { sourceKey: 'call_duration', targetKey: 'call_duration', reason: REJECT_ALREADY_PROVIDED },
    ]);
  });

  it('applies the transform to the mapped value', () => {
    const result = applyFieldMappings('contact', { call_duration: '95' }, [
      mapping({ transform: 'number' }),
    ]);

    expect(result.data.customFields).toEqual({ call_duration: 95 });
  });

  it('applies a transform to a native target too', () => {
    const result = applyFieldMappings('contact', { contact_email: '  USER@Example.COM  ' }, [
      mapping({ sourceKey: 'contact_email', targetType: 'native', targetKey: 'email', transform: 'trim' }),
    ]);

    expect(result.data.email).toBe('USER@Example.COM');
  });

  it('stores null when the transform cannot produce a value', () => {
    const result = applyFieldMappings('contact', { call_duration: 'unknown' }, [
      mapping({ transform: 'number' }),
    ]);

    expect(result.data.customFields).toEqual({ call_duration: null });
    expect(result.applied).toHaveLength(1);
  });

  it('reports applied entries accurately across a mixed batch', () => {
    const result = applyFieldMappings(
      'contact',
      { a: 1, b: 2, c: 3, missing_key: undefined },
      [
        mapping({ sourceKey: 'a', targetType: 'custom_field', targetKey: 'alpha' }),
        mapping({ sourceKey: 'b', targetType: 'native', targetKey: 'notes' }),
        mapping({ sourceKey: 'c', targetType: 'native', targetKey: 'createdBy' }),
        mapping({ sourceKey: 'never_sent', targetType: 'custom_field', targetKey: 'gamma' }),
      ]
    );

    expect(result.applied).toEqual([
      { sourceKey: 'a', targetType: 'custom_field', targetKey: 'alpha' },
      { sourceKey: 'b', targetType: 'native', targetKey: 'notes' },
    ]);
    expect(result.rejected).toEqual([
      { sourceKey: 'c', targetKey: 'createdBy', reason: REJECT_NATIVE_NOT_ALLOWED },
    ]);
    expect(result.data.notes).toBe(2);
    expect(result.data.customFields).toEqual({ alpha: 1 });
  });

  it('lets the first mapping win when two target the same field', () => {
    const result = applyFieldMappings('contact', { a: 'first', b: 'second' }, [
      mapping({ sourceKey: 'a', targetType: 'custom_field', targetKey: 'shared' }),
      mapping({ sourceKey: 'b', targetType: 'custom_field', targetKey: 'shared' }),
    ]);

    expect(result.data.customFields).toEqual({ shared: 'first' });
    expect(result.rejected).toEqual([
      { sourceKey: 'b', targetKey: 'shared', reason: REJECT_ALREADY_PROVIDED },
    ]);
  });

  it('returns a copy of the payload when there are no mappings', () => {
    const input = { email: 'a@b.com' };
    const result = applyFieldMappings('contact', input, []);

    expect(result.data).toEqual(input);
    expect(result.data).not.toBe(input);
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('ignores malformed mapping rows', () => {
    const result = applyFieldMappings('contact', { call_duration: 95 }, [
      mapping({ sourceKey: '' }),
      mapping({ targetKey: '' }),
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('treats an unrecognised targetType as a custom field', () => {
    const result = applyFieldMappings('contact', { call_duration: 95 }, [
      mapping({ targetType: 'something_else' }),
    ]);

    expect(result.data.customFields).toEqual({ call_duration: 95 });
    expect(result.applied[0]!.targetType).toBe('custom_field');
  });

  it('routes a realistic voice-API payload', () => {
    // What a telephony provider actually posts. Before mapping, everything past
    // first_name/email was accepted with a 200 and thrown away.
    const payload = {
      first_name: 'Asha',
      email: 'asha@example.com',
      call_duration: '182',
      transcript: 'Customer asked about pricing.',
      recording_url: 'https://voice.example.com/rec/1.mp3',
    };

    const result = applyFieldMappings('contact', payload, [
      mapping({ sourceKey: 'call_duration', targetKey: 'call_duration', transform: 'number' }),
      mapping({ sourceKey: 'transcript', targetKey: 'transcript' }),
    ]);

    expect(result.data.customFields).toEqual({
      call_duration: 182,
      transcript: 'Customer asked about pricing.',
    });
    // recording_url has no mapping, so it stays unmapped and unstored.
    expect(result.applied.map((a) => a.sourceKey)).toEqual(['call_duration', 'transcript']);
    expect(result.applied.some((a) => a.sourceKey === 'recording_url')).toBe(false);
    expect(result.rejected).toEqual([]);
    // The record's own fields are untouched.
    expect(result.data.first_name).toBe('Asha');
    expect(result.data.email).toBe('asha@example.com');
  });
});

describe('loadFieldMappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
  });

  it('returns [] without querying when the tenant id is missing', async () => {
    selectRows = [{ sourceKey: 'x', targetType: 'native', targetKey: 'notes', apiKeyId: null }];
    expect(await loadFieldMappings('', API_KEY, 'contact')).toEqual([]);
    expect(await loadFieldMappings(TENANT, API_KEY, '')).toEqual([]);
  });

  it('returns the tenant-wide mappings when no key-specific row exists', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'call_duration', transform: null, isActive: true, apiKeyId: null },
    ];

    const result = await loadFieldMappings(TENANT, API_KEY, 'contact');

    expect(result).toHaveLength(1);
    expect(result[0]!.targetKey).toBe('call_duration');
  });

  it('prefers the key-specific mapping over the tenant-wide one for the same source key', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'tenant_wide', transform: null, isActive: true, apiKeyId: null },
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'key_specific', transform: null, isActive: true, apiKeyId: API_KEY },
    ];

    const result = await loadFieldMappings(TENANT, API_KEY, 'contact');

    expect(result).toHaveLength(1);
    expect(result[0]!.targetKey).toBe('key_specific');
  });

  it('prefers the key-specific mapping regardless of row order', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'key_specific', transform: null, isActive: true, apiKeyId: API_KEY },
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'tenant_wide', transform: null, isActive: true, apiKeyId: null },
    ];

    const result = await loadFieldMappings(TENANT, API_KEY, 'contact');

    expect(result).toHaveLength(1);
    expect(result[0]!.targetKey).toBe('key_specific');
  });

  it('keeps mappings for different source keys side by side', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'call_duration', transform: null, isActive: true, apiKeyId: null },
      { sourceKey: 'transcript', targetType: 'custom_field', targetKey: 'transcript', transform: null, isActive: true, apiKeyId: API_KEY },
    ];

    const result = await loadFieldMappings(TENANT, API_KEY, 'contact');

    expect(result.map((m) => m.sourceKey).sort()).toEqual(['call_duration', 'transcript']);
  });

  it('works when the request carries no API key id', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'call_duration', transform: null, isActive: true, apiKeyId: null },
    ];

    const result = await loadFieldMappings(TENANT, null, 'contact');

    expect(result).toHaveLength(1);
  });

  it('feeds straight into applyFieldMappings', async () => {
    selectRows = [
      { sourceKey: 'call_duration', targetType: 'custom_field', targetKey: 'duration_seconds', transform: 'number', isActive: true, apiKeyId: API_KEY },
    ];

    const mappings = await loadFieldMappings(TENANT, API_KEY, 'contact');
    const result = applyFieldMappings('contact', { call_duration: '182' }, mappings);

    expect(result.data.customFields).toEqual({ duration_seconds: 182 });
  });
});
