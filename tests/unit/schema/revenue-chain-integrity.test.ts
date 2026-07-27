import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  invoices,
  invoiceLineItems,
  invoicePayments,
  orders,
  orderLineItems,
} from '@/drizzle/schema/billing';
import { quotes, quoteLineItems, products } from '@/drizzle/schema/crm';

/**
 * These assertions encode two properties that were both violated:
 *
 *   1. Every tenant-scoped table needs a uuid `tenant_id`. Without it the table
 *      cannot carry a tenant_isolation RLS policy, and migration 0034 aborted
 *      trying to give one to tables that had no such column.
 *
 *   2. The quote -> order -> invoice -> payment chain needs real foreign keys.
 *      None of these columns had one, so an invoice could reference a deleted
 *      quote, a line item could reference no invoice, and a payment could attach
 *      to nothing.
 */

function columns(table: PgTable) {
  return getTableConfig(table).columns;
}

function column(table: PgTable, name: string) {
  return columns(table).find((c) => c.name === name);
}

/** Names of columns that carry a foreign key on this table. */
function fkColumns(table: PgTable): Set<string> {
  const set = new Set<string>();
  for (const fk of getTableConfig(table).foreignKeys) {
    for (const col of fk.reference().columns) set.add(col.name);
  }
  return set;
}

const REVENUE_TABLES: [string, PgTable][] = [
  ['invoices', invoices],
  ['invoice_line_items', invoiceLineItems],
  ['invoice_payments', invoicePayments],
  ['orders', orders],
  ['order_line_items', orderLineItems],
  ['quotes', quotes],
  ['quote_line_items', quoteLineItems],
];

describe('revenue chain schema integrity', () => {
  describe('tenant scoping', () => {
    it.each(REVENUE_TABLES)('%s has a uuid tenant_id', (_name, table) => {
      const tenantId = column(table, 'tenant_id');
      expect(tenantId, 'tenant_id column must exist for RLS').toBeDefined();
      expect(tenantId!.columnType).toBe('PgUUID');
    });

    // A nullable tenant_id combined with the `tenant_id IS NULL` clause in the
    // RLS policy would make those rows readable by every tenant.
    it.each(REVENUE_TABLES)('%s has a NOT NULL tenant_id', (_name, table) => {
      expect(column(table, 'tenant_id')!.notNull).toBe(true);
    });
  });

  describe('foreign keys', () => {
    // The label is a single string so that a failure prints "invoices.quote_id"
    // rather than serialising the entire Drizzle table object into the title.
    const cases: [string, PgTable, string][] = [
      ['invoices.quote_id', invoices, 'quote_id'],
      ['invoices.order_id', invoices, 'order_id'],
      ['invoices.parent_invoice_id', invoices, 'parent_invoice_id'],
      ['orders.quote_id', orders, 'quote_id'],
      ['orders.invoice_id', orders, 'invoice_id'],
      ['invoice_line_items.invoice_id', invoiceLineItems, 'invoice_id'],
      ['invoice_line_items.product_id', invoiceLineItems, 'product_id'],
      ['invoice_line_items.service_id', invoiceLineItems, 'service_id'],
      ['order_line_items.order_id', orderLineItems, 'order_id'],
      ['order_line_items.product_id', orderLineItems, 'product_id'],
      ['order_line_items.service_id', orderLineItems, 'service_id'],
      ['invoice_payments.invoice_id', invoicePayments, 'invoice_id'],
      ['quote_line_items.quote_id', quoteLineItems, 'quote_id'],
      ['quote_line_items.product_id', quoteLineItems, 'product_id'],
    ];

    it.each(cases)('%s is a foreign key', (label, table, col) => {
      expect(column(table, col), `${label} should exist`).toBeDefined();
      expect(fkColumns(table), `${label} should have a foreign key`).toContain(col);
    });
  });

  describe('line item tables agree with each other', () => {
    // quote_line_items previously had only product_id, so a service could be
    // invoiced but never quoted, and conversion relabelled it as a product.
    const lineItemTables: [string, PgTable][] = [
      ['quote_line_items', quoteLineItems],
      ['order_line_items', orderLineItems],
      ['invoice_line_items', invoiceLineItems],
    ];

    it.each(lineItemTables)('%s can reference a product and a service', (_n, table) => {
      expect(column(table, 'product_id')).toBeDefined();
      expect(column(table, 'service_id')).toBeDefined();
    });

    it.each(lineItemTables)('%s records what kind of item it is', (_n, table) => {
      const itemType = column(table, 'item_type');
      expect(itemType, 'item_type distinguishes product from service').toBeDefined();
      expect(itemType!.notNull).toBe(true);
    });
  });

  describe('cascade behaviour', () => {
    function onDelete(table: PgTable, col: string): string | undefined {
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        if (ref.columns.some((c) => c.name === col)) return fk.onDelete;
      }
      return undefined;
    }

    // Child rows of a document should disappear with it...
    it('line items and payments cascade from their parent document', () => {
      expect(onDelete(invoiceLineItems, 'invoice_id')).toBe('cascade');
      expect(onDelete(orderLineItems, 'order_id')).toBe('cascade');
      expect(onDelete(invoicePayments, 'invoice_id')).toBe('cascade');
      expect(onDelete(quoteLineItems, 'quote_id')).toBe('cascade');
    });

    // ...but deleting a quote must never delete the invoice raised from it, and
    // deleting a product must never delete historical billing records.
    it('does not cascade a quote or product deletion into money records', () => {
      expect(onDelete(invoices, 'quote_id')).toBe('set null');
      expect(onDelete(orders, 'quote_id')).toBe('set null');
      expect(onDelete(invoiceLineItems, 'product_id')).toBe('set null');
      expect(onDelete(orderLineItems, 'product_id')).toBe('set null');
      expect(onDelete(quoteLineItems, 'product_id')).toBe('set null');
    });
  });

  it('products is reachable from every line item table', () => {
    // Guards against the import alias in billing.ts silently resolving to the
    // wrong table, which a plain FK-presence check would not catch.
    const productTableName = getTableConfig(products).name;
    for (const table of [invoiceLineItems, orderLineItems, quoteLineItems]) {
      const fk = getTableConfig(table).foreignKeys.find((f) =>
        f.reference().columns.some((c) => c.name === 'product_id')
      );
      expect(getTableConfig(fk!.reference().foreignTable).name).toBe(productTableName);
    }
  });
});
