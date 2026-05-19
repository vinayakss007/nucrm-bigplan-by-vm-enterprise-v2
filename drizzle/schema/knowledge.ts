import { pgTable, uuid, text, timestamp, jsonb, index, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';
import { tenants, users } from './core';

export const kbCategories = pgTable('kb_categories', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  icon: text('icon').default('Book'),
  order: integer('order').default(0),
  parentId: uuid('parent_id'),
  ...utils.audit(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    activeIdx: utils.activeIdx(table),
    slugIdx: index('idx_kb_categories_slug').on(table.tenantId, table.slug),
  };
});

export const kbArticles = pgTable('kb_articles', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  categoryId: uuid('category_id').references(() => kbCategories.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content').notNull(),
  excerpt: text('excerpt'),
  status: text('status').notNull().default('draft'), // 'draft', 'published', 'archived'
  views: integer('views').default(0),
  helpful: integer('helpful').default(0),
  notHelpful: integer('not_helpful').default(0),
  tags: text('tags').array().default(sql`'{}'`),
  metadata: utils.metadata(),
  ...utils.audit(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    categoryIdx: index('idx_kb_articles_category').on(table.categoryId),
    statusIdx: index('idx_kb_articles_status').on(table.tenantId, table.status),
    slugIdx: index('idx_kb_articles_slug').on(table.tenantId, table.slug),
    fullTextIdx: index('idx_kb_articles_search').using('gin',
      sql`to_tsvector('english', coalesce(${table.title}, '') || ' ' || coalesce(${table.content}, ''))`
    ),
    metadataGinIdx: utils.metadataIdx(table),
    activeIdx: utils.activeIdx(table),
  };
});
