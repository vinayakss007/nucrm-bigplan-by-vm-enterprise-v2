import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envFile = resolve(__dirname, '.env.local');
if (existsSync(envFile)) {
  const content = readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/nucrm_test';
}
// pgSslConfig() defaults TLS to on; the local test database speaks plaintext,
// so a suite pointed at localhost must not attempt SSL unless told otherwise.
if (!process.env.DATABASE_SSL && /@localhost|@127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_SSL = 'false';
}
if (!process.env['JWT_SECRET']) {
  process.env['JWT_SECRET'] = 'a0b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2x3y4z5';
}
if (!process.env['SESSION_SECRET']) {
  process.env['SESSION_SECRET'] = 'a0b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2x3y4z5';
}
if (!process.env['NEXT_PUBLIC_APP_URL']) {
  process.env['NEXT_PUBLIC_APP_URL'] = 'http://localhost:3000';
}
