import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildInsert, buildUpdate, countRows, dbCache, invalidateCache } from '@/lib/db/client';

describe('buildInsert', () => {
  it('generates correct INSERT query', () => {
    const { sql, values } = buildInsert('users', {
      name: 'John',
      email: 'john@test.com',
    });
    expect(sql).toContain('INSERT INTO public.users');
    expect(sql).toContain('"name"');
    expect(sql).toContain('"email"');
    expect(sql).toContain('RETURNING *');
    expect(values).toEqual(['John', 'john@test.com']);
  });

  it('throws on empty data', () => {
    expect(() => buildInsert('users', {})).toThrow('no fields');
  });

  it('filters out protected fields', () => {
    const { sql, values } = buildInsert('users', {
      name: 'John',
      password_hash: 'secret',
      is_super_admin: true,
      email: 'john@test.com',
    });
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('is_super_admin');
    expect(values).toEqual(['John', 'john@test.com']);
  });

  it('rejects invalid table names', () => {
    expect(() => buildInsert('invalid_table', { name: 'Test' })).toThrow('Invalid table name');
  });

  it('accepts valid table names', () => {
    expect(() => buildInsert('contacts', { first_name: 'John' })).not.toThrow();
    expect(() => buildInsert('deals', { title: 'Test Deal' })).not.toThrow();
    expect(() => buildInsert('tasks', { title: 'Test Task' })).not.toThrow();
  });
});

describe('buildUpdate', () => {
  it('generates correct UPDATE query', () => {
    const { sql, values } = buildUpdate('users', { name: 'Jane' }, { id: '123' });
    expect(sql).toContain('UPDATE public.users SET');
    expect(sql).toContain('"name"=$1');
    expect(sql).toContain('"id"=$2');
    expect(sql).toContain('updated_at=now()');
    expect(sql).toContain('RETURNING *');
    expect(values).toEqual(['Jane', '123']);
  });

  it('handles multiple set fields', () => {
    const { values } = buildUpdate('users', { name: 'Jane', email: 'j@test.com' }, { id: '123' });
    expect(values).toHaveLength(3);
    expect(values).toContain('Jane');
    expect(values).toContain('j@test.com');
    expect(values).toContain('123');
  });

  it('filters out undefined and protected fields', () => {
    const { sql, values } = buildUpdate('users', {
      name: 'Jane',
      password_hash: 'newhash',
      email: undefined,
    }, { id: '123' });
    expect(sql).not.toContain('password_hash');
    expect(sql).not.toContain('email');
    expect(values).not.toContain('newhash');
  });

  it('throws on no valid fields', () => {
    expect(() => buildUpdate('users', { password_hash: 'secret' }, { id: '123' })).toThrow('no fields');
  });

  it('rejects invalid table names', () => {
    expect(() => buildUpdate('invalid_table', { name: 'Test' }, { id: '1' })).toThrow('Invalid table name');
  });
});

describe('dbCache', () => {
  beforeEach(() => {
    invalidateCache('test:');
  });

  it('caches result on first call', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'hello' });
    const r1 = await dbCache('test:cache1', 5000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ data: 'hello' });
  });

  it('returns cached result on second call (within TTL)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'hello' });
    await dbCache('test:cache2', 5000, fetcher);
    await dbCache('test:cache2', 5000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expires', async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'fresh' });
    await dbCache('test:cache3', 10, fetcher);
    await new Promise(r => setTimeout(r, 20));
    await dbCache('test:cache3', 10, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses different cache keys independently', async () => {
    const fetcher1 = vi.fn().mockResolvedValue('a');
    const fetcher2 = vi.fn().mockResolvedValue('b');
    await dbCache('test:key1', 5000, fetcher1);
    await dbCache('test:key2', 5000, fetcher2);
    expect(fetcher1).toHaveBeenCalledTimes(1);
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateCache', () => {
  beforeEach(() => {
    invalidateCache('inv:');
  });

  it('removes entries matching prefix', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');
    await dbCache('inv:item1', 5000, fetcher);
    await dbCache('inv:item2', 5000, fetcher);
    invalidateCache('inv:');
    await dbCache('inv:item1', 5000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); // 2 initial + 1 after invalidation
  });

  it('does not remove entries with different prefix', async () => {
    const fetcher1 = vi.fn().mockResolvedValue('keep');
    const fetcher2 = vi.fn().mockResolvedValue('remove');
    await dbCache('keep:item', 5000, fetcher1);
    await dbCache('inv:item', 5000, fetcher2);
    invalidateCache('inv:');
    await dbCache('keep:item', 5000, fetcher1);
    expect(fetcher1).toHaveBeenCalledTimes(1); // Still cached
  });
});
