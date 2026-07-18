/**
 * Unit test for backup parser
 * Tests the core SQL parsing logic without needing a database
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// We'll test the parsing logic directly since we can't import TypeScript
// These tests mirror the logic in lib/restore/backup-parser.ts

// Test SQL statements
const VALID_INSERT = `INSERT INTO public.contacts (id, tenant_id, first_name, email, created_at) VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 't1e2n3a4-n5t6-7890-abcd-ef1234567890', 'John', 'john@example.com', '2026-04-15 10:00:00');`;

const INVALID_NO_VALUES = `INSERT INTO public.contacts (id, tenant_id) VALUES;`;

const NOT_INSERT = `CREATE TABLE test (id UUID);`;

// Regex from backup-parser.ts
const INSERT_REGEX = /INSERT\s+INTO\s+(?:public\.)?(\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.+)\);?\s*$/i;

function parseInsertStatement(line) {
  const match = line.match(INSERT_REGEX);
  if (!match) return null;

  const table = match[1];
  const columnsStr = match[2];
  const valuesStr = match[3];
  const columns = columnsStr.split(',').map(c => c.trim().replace(/"/g, ''));
  
  // Simple value parser
  const values = [];
  let current = '';
  let inQuotes = false;
  let escapeNext = false;
  
  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    if (escapeNext) { current += char; escapeNext = false; continue; }
    if (char === '\\') { current += char; escapeNext = true; continue; }
    if (char === "'") { inQuotes = !inQuotes; current += char; continue; }
    if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) values.push(current.trim());

  if (columns.length !== values.length) return null;
  return { table, columns, values, rawStatement: line };
}

function extractUUIDValue(sqlValue) {
  if (!sqlValue || sqlValue === 'NULL' || sqlValue === 'null') return null;
  if (sqlValue.startsWith("'") && sqlValue.endsWith("'")) {
    return sqlValue.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'");
  }
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log('\n🧪 Backup Parser Tests\n');

// Parse INSERT statements
test('Parses valid INSERT statement', () => {
  const result = parseInsertStatement(VALID_INSERT);
  assert.ok(result, 'Should parse successfully');
  assert.strictEqual(result.table, 'contacts');
  assert.strictEqual(result.columns.length, 5);
  assert.strictEqual(result.values.length, 5);
});

test('Extracts column names correctly', () => {
  const result = parseInsertStatement(VALID_INSERT);
  assert.deepStrictEqual(result.columns, ['id', 'tenant_id', 'first_name', 'email', 'created_at']);
});

test('Extracts values correctly', () => {
  const result = parseInsertStatement(VALID_INSERT);
  assert.ok(result.values[0].includes('a1b2c3d4'), 'First value should contain UUID');
  assert.ok(result.values[2].includes('John'), 'Third value should be John');
});

test('Returns null for invalid INSERT', () => {
  const result = parseInsertStatement(INVALID_NO_VALUES);
  assert.strictEqual(result, null);
});

test('Returns null for non-INSERT statement', () => {
  const result = parseInsertStatement(NOT_INSERT);
  assert.strictEqual(result, null);
});

test('Extracts tenant_id correctly', () => {
  const result = parseInsertStatement(VALID_INSERT);
  const tenantIdIdx = result.columns.indexOf('tenant_id');
  const tenantId = extractUUIDValue(result.values[tenantIdIdx]);
  assert.strictEqual(tenantId, 't1e2n3a4-n5t6-7890-abcd-ef1234567890');
});

test('Handles quoted strings with commas', () => {
  const stmt = `INSERT INTO public.companies (id, tenant_id, name) VALUES ('111', '222', 'Acme, Inc.');`;
  const result = parseInsertStatement(stmt);
  assert.ok(result, 'Should parse');
  assert.strictEqual(result.values[2], `'Acme, Inc.'`);
});

test('Handles empty string values', () => {
  const stmt = `INSERT INTO public.contacts (id, tenant_id, phone) VALUES ('111', '222', '');`;
  const result = parseInsertStatement(stmt);
  assert.ok(result);
  assert.strictEqual(result.values[2], `''`);
});

// File system tests
test('Can create and read temp SQL file', () => {
  const tmpDir = os.tmpdir();
  const testFile = path.join(tmpDir, 'test-backup-' + Date.now() + '.sql');
  
  const content = [
    VALID_INSERT,
    `INSERT INTO public.deals (id, tenant_id, title) VALUES ('d1', 't1', 'Big Deal');`,
    `INSERT INTO public.contacts (id, tenant_id, first_name) VALUES ('c2', 't1', 'Jane');`,
    NOT_INSERT,
  ].join('\n');
  
  fs.writeFileSync(testFile, content);
  assert.ok(fs.existsSync(testFile));
  
  const readContent = fs.readFileSync(testFile, 'utf8');
  assert.ok(readContent.includes('INSERT'));
  
  fs.unlinkSync(testFile);
});

test('Parses multiple INSERT statements from file content', () => {
  const lines = [
    `INSERT INTO public.contacts (id, tenant_id, first_name) VALUES ('c1', 't1', 'John');`,
    `INSERT INTO public.deals (id, tenant_id, title) VALUES ('d1', 't1', 'Big Deal');`,
    `INSERT INTO public.contacts (id, tenant_id, first_name) VALUES ('c2', 't1', 'Jane');`,
    `INSERT INTO public.contacts (id, tenant_id, first_name) VALUES ('c3', 't2', 'Bob');`,
    NOT_INSERT,
    `INSERT INTO public.tasks (id, tenant_id, subject) VALUES ('tk1', 't1', 'Follow up');`,
  ];
  
  const tenantMap = {};
  let statementCount = 0;
  
  for (const line of lines) {
    const result = parseInsertStatement(line);
    if (!result) continue;
    statementCount++;
    
    const tenantIdIdx = result.columns.indexOf('tenant_id');
    if (tenantIdIdx === -1) continue;
    
    const tenantId = extractUUIDValue(result.values[tenantIdIdx]);
    if (!tenantId) continue;
    
    if (!tenantMap[tenantId]) {
      tenantMap[tenantId] = { record_counts: {}, total_records: 0 };
    }
    tenantMap[tenantId].record_counts[result.table] = (tenantMap[tenantId].record_counts[result.table] || 0) + 1;
    tenantMap[tenantId].total_records++;
  }
  
  assert.strictEqual(statementCount, 5, 'Should parse 5 INSERT statements');
  assert.ok(tenantMap['t1'], 'Should have t1 tenant');
  assert.ok(tenantMap['t2'], 'Should have t2 tenant');
  assert.strictEqual(tenantMap['t1'].total_records, 4, 't1 should have 4 records');
  assert.strictEqual(tenantMap['t2'].total_records, 1, 't2 should have 1 record');
});

test('Handles NULL values', () => {
  const stmt = `INSERT INTO public.contacts (id, tenant_id, phone) VALUES ('111', '222', NULL);`;
  const result = parseInsertStatement(stmt);
  assert.ok(result);
  assert.strictEqual(result.values[2], 'NULL');
});

// Summary
console.log(`\n${'─'.repeat(50)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
