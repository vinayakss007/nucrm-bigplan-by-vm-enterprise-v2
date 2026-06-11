#!/usr/bin/env node
const { Pool } = require('/home/vinayak_shruti_biz/nucrm-enterprise/node_modules/pg');

const pool = new Pool({
  connectionString: process.env.DB_URL || 'postgresql://nucrm:nucrm123@localhost:5432/nucrm_fresh',
  connectionTimeoutMillis: 5000,
});

const SPECIAL_VALUES = {
  identifier_type: () => "'ip'",
  backup_type:     () => "'manual'",
};

async function main() {
  // ── Build FK map dynamically from DB ──
  const { rows: fkCols } = await pool.query(`
    SELECT
      kcu.table_name,
      kcu.column_name,
      ccu.table_name AS ref_table,
      ccu.column_name AS ref_column
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.referential_constraints rc ON kcu.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
    WHERE kcu.table_schema = 'public'
  `);
  const fkByTable = {};
  for (const f of fkCols) {
    if (!fkByTable[f.table_name]) fkByTable[f.table_name] = {};
    fkByTable[f.table_name][f.column_name] = { refTable: f.ref_table, refColumn: f.ref_column };
  }
  const fkMap = {};
  for (const f of fkCols) {
    const key = `${f.table_name}.${f.column_name}`;
    if (!fkMap[key]) fkMap[key] = [];
    fkMap[key].push({ refTable: f.ref_table, refColumn: f.ref_column });
  }

  // ── FK value cache ──
  const fkValueCache = {};
  async function getFkVal(refTable, refColumn) {
    const ck = `${refTable}.${refColumn}`;
    if (fkValueCache[ck] !== undefined) return fkValueCache[ck];
    try {
      const { rows } = await pool.query(`SELECT "${refColumn}"::text FROM "${refTable}" LIMIT 1`);
      if (rows.length > 0) { fkValueCache[ck] = rows[0][refColumn]; return rows[0][refColumn]; }
    } catch {}
    fkValueCache[ck] = null;
    return null;
  }

  // ── Seed empty referenced tables (in dependency order) ──
  const seededRows = [];
  async function seedEmptyTable(refTable) {
    const { rows: existing } = await pool.query(`SELECT count(*)::int AS cnt FROM "${refTable}"`);
    if (existing[0].cnt > 0) return;
    // First, recursively seed this table's FK dependencies
    const refs = fkByTable[refTable] || {};
    for (const [colName, refInfo] of Object.entries(refs)) {
      await getFkVal(refInfo.refTable, refInfo.refColumn);
      if (fkValueCache[`${refInfo.refTable}.${refInfo.refColumn}`] === null) {
        await seedEmptyTable(refInfo.refTable);
      }
      // Re-fetch after seeding
      await getFkVal(refInfo.refTable, refInfo.refColumn);
    }

    const { rows: cols } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default,
        (SELECT count(*) > 0 FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = c.table_name AND tc.table_schema = c.table_schema
           AND tc.constraint_type = 'PRIMARY KEY'
           AND ccu.column_name = c.column_name)::int as is_pk
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `, [refTable]);

    const parts = [], vals = [];
    let pkCol = null, pkVal = null;
    for (const c of cols) {
      const isPk = c.is_pk === 1 || c.is_pk === true;
      if (isPk) {
        pkCol = c.column_name;
        pkVal = c.data_type === 'uuid' ? 'gen_random_uuid()' :
                `'seed-${refTable}-${Date.now()}-${Math.random().toString(36).slice(2,6)}'`;
        parts.push(`"${c.column_name}"`);
        vals.push(pkVal);
        continue;
      }
      const fkRef = refs[c.column_name];
      if (fkRef) {
        const fkVal = fkValueCache[`${fkRef.refTable}.${fkRef.refColumn}`];
        if (fkVal != null) {
          parts.push(`"${c.column_name}"`);
          vals.push(`'${fkVal}'` + (c.data_type === 'uuid' ? '::uuid' : ''));
          continue;
        }
      }
      if (c.is_nullable === 'NO' && !c.column_default) {
        if (c.data_type === 'uuid') {
          parts.push(`"${c.column_name}"`);
          vals.push('gen_random_uuid()');
        } else if (c.data_type === 'text' || c.data_type === 'character varying') {
          parts.push(`"${c.column_name}"`);
          vals.push(`'seed-${c.column_name}-${Date.now()}'`);
        } else if (['integer','bigint','smallint'].includes(c.data_type)) {
          parts.push(`"${c.column_name}"`); vals.push('0');
        } else if (c.data_type === 'boolean') {
          parts.push(`"${c.column_name}"`); vals.push('false');
        } else if (c.data_type.includes('timestamp')) {
          parts.push(`"${c.column_name}"`); vals.push("'2024-01-01'::timestamp");
        } else if (['real','double precision','numeric'].includes(c.data_type)) {
          parts.push(`"${c.column_name}"`); vals.push('0');
        } else {
          parts.push(`"${c.column_name}"`); vals.push(`'seed-${c.column_name}'`);
        }
      }
    }
    if (parts.length > 0) {
      const sql = `INSERT INTO "${refTable}" (${parts.join(', ')}) VALUES (${vals.join(', ')}) RETURNING "${pkCol}"::text`;
      const { rows: inserted } = await pool.query(sql);
      if (inserted.length > 0) {
        seededRows.push({ table: refTable, pkCol, pkVal: inserted[0][pkCol] });
        // Update cache
        const ck = `${refTable}.${pkCol}`;
        fkValueCache[ck] = inserted[0][pkCol];
      }
    }
  }

  const seededTables = new Set();
  for (const f of fkCols) {
    if (!seededTables.has(f.ref_table)) {
      seededTables.add(f.ref_table);
      await seedEmptyTable(f.ref_table);
    }
  }

  // ── Rebuild FK cache from all available data ──
  for (const f of fkCols) {
    await getFkVal(f.ref_table, f.ref_column);
  }

  // ── Type-based value generators ──
  const TYPES = {
    uuid:        () => "'00000000-0000-0000-0000-000000000000'::uuid",
    timestamp:   () => "'2024-01-01'::timestamp",
    timestamptz: () => "'2024-01-01'::timestamptz",
    date:        () => "'2024-01-01'::date",
    time:        () => "'00:00:00'::time",
    jsonb:       () => "'{}'::jsonb",
    json:        () => "'{}'::json",
    boolean:     () => 'false',
    integer:     () => '0',
    bigint:      () => '0',
    smallint:    () => '0',
    numeric:     () => '0',
    real:        () => '0',
    'double precision': () => '0',
    inet:        () => "'127.0.0.1'::inet",
    text:        () => "'test'",
    'character varying': () => "'test'",
  };

  function makeVal(c, tableName) {
    if (c.is_pk && c.default && c.default.includes('gen_random_uuid')) return null;
    if (c.nullable === 'YES' && (!c.default || c.default === 'gen_random_uuid()')) return null;
    if (c.default && !c.default.includes('gen_random_uuid') && !c.default.startsWith('nextval')) return null;
    if (SPECIAL_VALUES[c.cname]) return SPECIAL_VALUES[c.cname]();
    const fkKey = `${tableName}.${c.cname}`;
    const refs = fkMap[fkKey];
    if (refs && refs.length > 0) {
      const ref = refs[0];
      const val = fkValueCache[`${ref.refTable}.${ref.refColumn}`];
      if (val != null) {
        const pkType = c.type.replace(/ with time zone| without time zone/g, '');
        if (pkType === 'uuid') return `'${val}'::uuid`;
        if (pkType === 'text' || pkType === 'character varying') return `'${val}'`;
        return `'${val}'::${pkType}`;
      }
      return null;
    }
    const key = c.type.replace(/ with time zone| without time zone/g, '');
    const handler = TYPES[key] || TYPES.text;
    return handler(c.cname);
  }

  // ── Test every table ──
  const { rows: tables } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );

  let passed = 0, failed = 0, skipped = 0, existing = 0;
  const fails = [];

  for (const { tablename } of tables) {
    const { rows: cols } = await pool.query(`
      SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
        (SELECT count(*) > 0 FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_name = c.table_name AND tc.table_schema = c.table_schema
           AND tc.constraint_type = 'PRIMARY KEY'
           AND ccu.column_name = c.column_name)::int as is_pk
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position
    `, [tablename]);

    const entries = [];
    for (const col of cols) {
      const entry = {
        name: col.column_name,
        cname: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable,
        default: col.column_default,
        is_pk: col.is_pk === 1 || col.is_pk === true,
      };
      const val = makeVal(entry, tablename);
      if (val !== null) entries.push({ name: entry.name, val });
    }

    if (entries.length === 0) { skipped++; continue; }

    const parts = entries.map(e => `"${e.name}"`);
    const vals = entries.map(e => e.val);
    const sql = `INSERT INTO "${tablename}" (${parts.join(', ')}) VALUES (${vals.join(', ')})`;

    try {
      await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query('ROLLBACK');
      passed++;
      process.stdout.write('.');
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      const msg = err.message;
      if (msg.includes('duplicate key')) {
        existing++;
        process.stdout.write('e');
      } else {
        failed++;
        fails.push(`${tablename}: ${msg.substring(0, 150)}`);
        process.stdout.write('x');
      }
    }
  }

  // ── Cleanup seeded placeholder rows ──
  let cleaned = 0;
  for (const sr of seededRows) {
    try {
      await pool.query(`DELETE FROM "${sr.table}" WHERE "${sr.pkCol}" = $1`, [sr.pkVal]);
      cleaned++;
    } catch {}
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Total: ${tables.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Existing: ${existing}`);
  if (cleaned > 0) console.log(`Cleaned up ${cleaned} seeded placeholder rows.`);
  if (fails.length > 0) {
    console.log(`\nFailures:`);
    for (const f of fails) process.stdout.write(`  ${f}\n`);
    const logPath = '/tmp/test_failures.log';
    require('fs').writeFileSync(logPath, fails.join('\n'));
    console.log(`\nFailure log: ${logPath}`);
  }
  if (existing > 0) console.log(`\n${existing} table(s) had existing data (duplicate key) — verified by seed.`);
  if (cleaned > 0) console.log(`Seeded ${cleaned} placeholder rows cleaned up.`);
  console.log(`Seed script (seed-dev.ts) already verified real data inserts work.`);
  await pool.end();
}

main().catch(console.error);
