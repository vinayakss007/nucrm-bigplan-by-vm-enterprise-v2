import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * #3251 — the ecosystem config said its apps load `.env.local`, and PM2 7.x
 * silently ignores the `env_file` key that says so, while `tsx` reads no `.env*`
 * file at all. So `cron` died on "FATAL: CRON_SECRET is required" and `worker`
 * fell back to redis://localhost:6379 — with the header reading as fixed.
 *
 * These assertions go through the parsed config, not the file's text, because
 * the text is what lied: a comment can name the preload all it likes, and only
 * `args` decides what PM2 launches.
 */

const ROOT = resolve(import.meta.dirname!, '..', '..');
const CONFIG = join(ROOT, 'ecosystem.config.cjs');
const load = createRequire(import.meta.url);

interface Pm2App {
  name: string;
  script: string;
  args?: string;
  cwd?: string;
  env_file?: string;
  env?: Record<string, string | number>;
  max_restarts?: number;
  restart_delay?: number;
}

const apps: Pm2App[] = (load(CONFIG) as { apps: Pm2App[] }).apps;
const tsxApps = apps.filter((a) => /tsx$/.test(a.script));
const byName = (name: string): Pm2App => {
  const found = apps.find((a) => a.name === name);
  if (!found) throw new Error(`no app named ${name}`);
  return found;
};

describe('#3251 every tsx sidecar preloads the env file itself', () => {
  it('has a sidecar to guard, so the filter below cannot pass by matching nothing', () => {
    expect(tsxApps.map((a) => a.name).sort()).toEqual(['cron', 'worker']);
  });

  it('passes the load-env preload in args, before the entry point', () => {
    for (const app of tsxApps) {
      expect(app.args, `${app.name} starts without the preload`).toMatch(
        /^--import \.\/scripts\/load-env\.mjs \S/,
      );
    }
  });

  it('resolves the preload against the cwd the app declares', () => {
    for (const app of tsxApps) {
      // args are relative, and PM2 runs them from `cwd`; a __dirname that moved
      // would leave the --import pointing at nothing.
      expect(app.cwd, `${app.name} cwd is not the config's own directory`).toBe(ROOT);
      const [lead, flag] = app.args!.split(' ');
      expect(lead, `${app.name} args must lead with the preload`).toBe('--import');
      expect(existsSync(join(app.cwd!, flag)), `${flag} missing for ${app.name}`).toBe(true);
    }
  });

  it('names an entry point that exists, so --import cannot silently eat the script', () => {
    for (const app of tsxApps) {
      const entry = app.args!.split(' ').at(-1)!;
      expect(existsSync(join(app.cwd ?? ROOT, entry)), `${app.name} entry ${entry}`).toBe(true);
    }
  });

  it('leaves web alone — Next.js reads .env.local itself and needs no preload', () => {
    expect(byName('web').args).not.toContain('load-env.mjs');
    expect(byName('web').script).toMatch(/next$/);
  });
});

describe('#3251 the config advertises no key PM2 ignores', () => {
  it('drops env_file from every app', () => {
    for (const app of apps) {
      expect(app, `${app.name} still carries env_file`).not.toHaveProperty('env_file');
    }
  });

  it('keeps env_file out of the source as a config key, while the header may name it', () => {
    const src = readFileSync(CONFIG, 'utf8');
    expect(src).not.toMatch(/^\s*env_file\s*:/m);
    // and the header still tells an operator WHY, which is the only place the
    // word should survive.
    expect(src).toMatch(/PM2 7\.x does NOT implement the `env_file` key/);
    expect(src).toContain('pm2-sidecar-env-preload-3251.test.ts');
  });
});

describe('#3251 cron survives the boot that the preload fixes', () => {
  it('restarts with worker\'s budget instead of burning five restarts in seconds', () => {
    const cron = byName('cron');
    expect(cron.max_restarts).toBe(10);
    expect(cron.restart_delay).toBe(2000);
    expect(cron.max_restarts).toBe(byName('worker').max_restarts);
  });
});

describe('#3251 the claim is corrected where an operator reads it', () => {
  it('credits the preload in the config doc, not a key PM2 ignores', () => {
    const doc = readFileSync(join(ROOT, 'docs/admin/configuration.md'), 'utf8');
    expect(doc).not.toMatch(/\(via PM2\s*\n?\s*`env_file`\)/);
    expect(doc).toContain('scripts/load-env.mjs');
    expect(doc).toMatch(/pm2 reload ecosystem\.config\.cjs --update-env/);
  });
});
