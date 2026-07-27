import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { tasks } from '@/drizzle/schema/tasks';
import { supportTickets } from '@/drizzle/schema/support';
import { activities } from '@/drizzle/schema/activity';
import { quotes } from '@/drizzle/schema/crm';
import { invoices } from '@/drizzle/schema/billing';
import {
  recordLinks,
  LINKABLE_ENTITY_TYPES,
  LINK_RELATIONS,
} from '@/drizzle/schema/record-links';

function config(table: PgTable) {
  return getTableConfig(table);
}

function fkFor(table: PgTable, col: string) {
  return config(table).foreignKeys.find((fk) =>
    fk.reference().columns.some((c) => c.name === col)
  );
}

function parentOf(table: PgTable, col: string): string | undefined {
  const fk = fkFor(table, col);
  return fk ? getTableConfig(fk.reference().foreignTable).name : undefined;
}

describe('cross-module record linking', () => {
  /**
   * Each of these was previously unrepresentable, which is what made the modules
   * feel siloed: the data simply had nowhere to record the relationship.
   */
  describe('first-class relationships have real foreign keys', () => {
    const cases: [string, PgTable, string, string][] = [
      ['tasks.company_id -> companies', tasks, 'company_id', 'companies'],
      ['tasks.lead_id -> leads', tasks, 'lead_id', 'leads'],
      ['tasks.ticket_id -> support_tickets', tasks, 'ticket_id', 'support_tickets'],
      ['support_tickets.company_id -> companies', supportTickets, 'company_id', 'companies'],
      ['support_tickets.deal_id -> deals', supportTickets, 'deal_id', 'deals'],
      ['support_tickets.lead_id -> leads', supportTickets, 'lead_id', 'leads'],
      ['quotes.company_id -> companies', quotes, 'company_id', 'companies'],
      ['invoices.deal_id -> deals', invoices, 'deal_id', 'deals'],
      ['activities.lead_id -> leads', activities, 'lead_id', 'leads'],
    ];

    it.each(cases)('%s', (label, table, col, parent) => {
      expect(fkFor(table, col), `${label} should be a foreign key`).toBeDefined();
      expect(parentOf(table, col), `${label} points at the wrong table`).toBe(parent);
    });

    // Losing a company must never delete the tasks, tickets, quotes or invoices
    // that referenced it — those records still have standalone meaning.
    it.each(cases.filter(([, table]) => table !== activities))(
      '%s does not cascade deletes',
      (_label, table, col) => {
        expect(fkFor(table, col)!.onDelete).toBe('set null');
      }
    );

    // activities is the deliberate exception: contact_id, deal_id and company_id
    // are all CASCADE there, because an activity about a deleted record has
    // nothing left to describe. lead_id must match its siblings.
    it('activities.lead_id cascades, consistent with its sibling columns', () => {
      const siblings = ['contact_id', 'deal_id', 'company_id', 'lead_id'];
      for (const col of siblings) {
        expect(fkFor(activities, col)?.onDelete, `activities.${col}`).toBe('cascade');
      }
    });
  });

  describe('activities treats leads like every other entity', () => {
    // contact/deal/company each had a denormalised column; lead did not, so lead
    // history was only reachable through entity_type/entity_id.
    it.each(['contact_id', 'deal_id', 'company_id', 'lead_id'])(
      'activities.%s exists',
      (col) => {
        expect(config(activities).columns.find((c) => c.name === col)).toBeDefined();
      }
    );
  });

  describe('record_links', () => {
    const cfg = () => config(recordLinks);

    it('is tenant scoped with a NOT NULL uuid tenant_id', () => {
      const tenantId = cfg().columns.find((c) => c.name === 'tenant_id');
      expect(tenantId).toBeDefined();
      expect(tenantId!.columnType).toBe('PgUUID');
      expect(tenantId!.notNull).toBe(true);
    });

    it('requires both endpoints', () => {
      for (const col of ['from_type', 'from_id', 'to_type', 'to_id']) {
        const c = cfg().columns.find((x) => x.name === col);
        expect(c, `${col} should exist`).toBeDefined();
        expect(c!.notNull, `${col} should be NOT NULL`).toBe(true);
      }
    });

    it('defaults the relation so a plain association needs no argument', () => {
      const relation = cfg().columns.find((c) => c.name === 'relation');
      expect(relation!.notNull).toBe(true);
      expect(relation!.hasDefault).toBe(true);
    });

    // The endpoints cannot be foreign-keyed, so these CHECKs are the only thing
    // preventing an invented entity kind from being stored.
    it('constrains entity types, relations, and self-links', () => {
      const names = cfg().checks.map((c) => c.name);
      expect(names).toContain('record_links_from_type_valid');
      expect(names).toContain('record_links_to_type_valid');
      expect(names).toContain('record_links_relation_valid');
      expect(names).toContain('record_links_not_self');
    });

    it('indexes both directions, because links are read from either end', () => {
      const names = cfg().indexes.map((i) => i.config.name);
      expect(names).toContain('idx_record_links_from');
      expect(names).toContain('idx_record_links_to');
    });

    it('makes linking idempotent via a unique constraint on the pair', () => {
      const unique = cfg().indexes.find((i) => i.config.name === 'idx_record_links_unique');
      expect(unique, 'a duplicate link must be impossible').toBeDefined();
      expect(unique!.config.unique).toBe(true);

      // Tenant must be part of the key, otherwise two tenants could not hold the
      // same pair of ids independently.
      const cols = (unique!.config.columns as { name?: string }[]).map((c) => c.name);
      expect(cols).toEqual([
        'tenant_id',
        'from_type',
        'from_id',
        'to_type',
        'to_id',
        'relation',
      ]);
    });

    it('is soft-deleted rather than removed outright', () => {
      expect(cfg().columns.find((c) => c.name === 'deleted_at')).toBeDefined();
    });
  });

  describe('entity type allowlist', () => {
    it('covers the modules the CRM actually links between', () => {
      for (const t of ['contact', 'company', 'lead', 'deal', 'task', 'ticket', 'invoice', 'quote']) {
        expect(LINKABLE_ENTITY_TYPES).toContain(t);
      }
    });

    it('has no duplicates', () => {
      expect(new Set(LINKABLE_ENTITY_TYPES).size).toBe(LINKABLE_ENTITY_TYPES.length);
    });

    it('offers "related" as the neutral default relation', () => {
      expect(LINK_RELATIONS).toContain('related');
      expect(new Set(LINK_RELATIONS).size).toBe(LINK_RELATIONS.length);
    });
  });
});
