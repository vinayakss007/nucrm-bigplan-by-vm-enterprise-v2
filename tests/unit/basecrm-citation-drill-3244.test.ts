/**
 * #3244's follow-up — the BASECRM rebuild reference's pinned citations, resolved.
 *
 * docs/BASECRM is written for someone rebuilding the CRM from zero, so a pointer is
 * a contract: `03` § 2 says `requireAuth` is at `middleware.ts:200` and the reader
 * goes there. Three audits of these files in one day (2d8aed836, 2ff3e88b5,
 * 5760c2538) each found pointers the previous audit had left wrong, and none of
 * them could be caught by any existing screen — no workflow reads a
 * `docs/BASECRM/**` citation, so the only thing between a stale `:N` and a
 * rebuilder is a human who happens to notice.
 *
 * What the last pass found, and what this file therefore pins:
 *
 *  - `03` cited `requireAuth` at `middleware.ts:341`. `:341` is the
 *    `COALESCE(roles.permissions, …)` select line — the very line `01:51` cites,
 *    correctly, for the select — while `01`'s heading and `06` step 5 both said
 *    `:200`. A wrong number inside a 500-line file still lands on plausible code,
 *    which is why "the file exists and the line is in range" is not a check.
 *  - `02` sent `sessions`/`refresh_tokens`/`invitations` to `core.ts:217…`, which is
 *    `field_permissions`, the next entry in the same sentence.
 *  - `05` cited `resolveDealStage` at `resolve-stage.ts:117` — the last line of its
 *    body (`return { ok: false, reason: 'missing' }`), not the function.
 *  - `06` step 4 listed `withAuthLookupContext` under "GUC helpers in
 *    `lib/db/rls.ts`". Four helpers are defined there; that one is defined at
 *    `token-credential-context.ts:90` and reaches `rls.ts` only through the re-export
 *    at `rls.ts:32-41`, while `withUnsubscribeContactContext` is not re-exported at
 *    all — so the summary had drifted from `01:88-96`, which says it correctly.
 *  - `03` § 1 / `06` step 3 described the *shipped* `tenant_isolation` policy as
 *    0037's. `0039:64-75` replaced it, USING-only, with an expression that begins
 *    `tenant_id IS NULL OR …` on every table, and a `FOR ALL` policy with no
 *    WITH CHECK reuses its USING for writes. So "no GUC returns 0 rows" is true
 *    only where `tenant_id` is NOT NULL, and 0037's strict write check is not
 *    what survives the chain. That is a claim about migration text, so it can be
 *    asserted here rather than remembered in prose.
 *
 * Each case asserts the pair, not one half of it: the doc must carry the pointer
 * and the cited source line must carry the thing the pointer promises. Fixing the
 * source without the doc fails; fixing the doc by guessing fails; and a future
 * merge that moves a cited symbol moves both sides of a pair deliberately.
 *
 * The generic scan at the bottom is deliberately weaker than the pinned pairs: it
 * can only prove a citation is *inside* its file. Half the refs in `05` are
 * directory-relative shorthand (`bulk/route.ts:29` under a heading that names
 * `app/api/tenant/deals/`), which matches nine tracked routes, so those are
 * range-checked against every candidate and only fail when past EOF in all of
 * them. Content-level truth for those lives in the PINNED pairs, which resolve the
 * directory by hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').split('\n');

/** doc file → the exact pointer string it must still contain → source truth. */
const PINNED: Array<{
  doc: string;
  cite: string;
  src: string;
  line: number;
  has: string;
  why: string;
}> = [
  {
    doc: 'docs/BASECRM/03-RBAC-AUTHZ.md',
    cite: 'middleware.ts:200',
    src: 'lib/auth/middleware.ts',
    line: 200,
    has: 'export async function requireAuth',
    why: 'the requireAuth definition, not the COALESCE select line at :341',
  },
  {
    doc: 'docs/BASECRM/01-ARCHITECTURE.md',
    cite: 'lib/auth/middleware.ts:200',
    src: 'lib/auth/middleware.ts',
    line: 200,
    has: 'export async function requireAuth',
    why: '01 and 03 must not disagree about the same symbol',
  },
  {
    doc: 'docs/BASECRM/06-REBUILD-GUIDE.md',
    cite: 'lib/auth/middleware.ts:200',
    src: 'lib/auth/middleware.ts',
    line: 200,
    has: 'export async function requireAuth',
    why: '06 step 5 — the third copy of the same coordinate',
  },
  {
    doc: 'docs/BASECRM/01-ARCHITECTURE.md',
    cite: 'lib/auth/middleware.ts:341',
    src: 'lib/auth/middleware.ts',
    line: 341,
    has: 'COALESCE(',
    why: ':341 is a real pointer for the permissions select and nothing else',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:185',
    src: 'drizzle/schema/core.ts',
    line: 185,
    has: "pgTable('sessions'",
    why: 'the sessions table',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:120',
    src: 'drizzle/schema/core.ts',
    line: 120,
    has: "pgTable('refresh_tokens'",
    why: 'the second of the three tables that used to share one ellipsis',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:379',
    src: 'drizzle/schema/core.ts',
    line: 379,
    has: "pgTable('invitations'",
    why: 'the third, and 259 lines away from sessions, which is the point of pinning it',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:217',
    src: 'drizzle/schema/core.ts',
    line: 217,
    has: "pgTable('field_permissions'",
    why: 'what :217 actually is — the number 02 used to spend on three other tables',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:231',
    src: 'drizzle/schema/core.ts',
    line: 231,
    has: "pgTable('record_permissions'",
    why: 'the record_permissions table',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'core.ts:324',
    src: 'drizzle/schema/core.ts',
    line: 324,
    has: "pgTable('audit_logs'",
    why: 'the audit_logs table',
  },
  {
    doc: 'docs/BASECRM/05-BUSINESS-FLOWS.md',
    cite: 'lib/deals/resolve-stage.ts:82',
    src: 'lib/deals/resolve-stage.ts',
    line: 82,
    has: 'export async function resolveDealStage',
    why: 'a "the create path calls X" bullet points at X',
  },
  {
    doc: 'docs/BASECRM/05-BUSINESS-FLOWS.md',
    cite: '`resolve-stage.ts:127`',
    src: 'lib/deals/resolve-stage.ts',
    line: 127,
    has: 'stage_id is required',
    why: 'the 400 message the same section quotes',
  },
  {
    doc: 'docs/BASECRM/03-RBAC-AUTHZ.md',
    cite: 'lib/db/rls.ts:120',
    src: 'lib/db/rls.ts',
    line: 120,
    has: 'export async function withTenantContext',
    why: 'the helper 01 and 03 both cite',
  },
  {
    doc: 'docs/BASECRM/06-REBUILD-GUIDE.md',
    cite: 'lib/db/rls.ts:32-41',
    src: 'lib/db/rls.ts',
    line: 35,
    has: 'withAuthLookupContext',
    why: 'the re-export range is what makes "import from rls.ts" and "defined elsewhere" both true',
  },
  {
    doc: 'docs/BASECRM/06-REBUILD-GUIDE.md',
    cite: 'lib/db/token-credential-context.ts:90',
    src: 'lib/db/token-credential-context.ts',
    line: 90,
    has: 'export async function withAuthLookupContext',
    why: 'step 4 — the definition 06 used to claim lived in rls.ts',
  },
  {
    doc: 'docs/BASECRM/06-REBUILD-GUIDE.md',
    cite: 'lib/db/unsubscribe-contact-context.ts:120',
    src: 'lib/db/unsubscribe-contact-context.ts',
    line: 120,
    has: 'export async function withUnsubscribeContactContext',
    why: 'step 4 — a module that is not re-exported, so the import path is the file itself',
  },
  {
    doc: 'docs/BASECRM/02-DATA-MODEL.md',
    cite: 'schemas.ts:224',
    src: 'lib/api/schemas.ts',
    line: 224,
    has: 'amount: z.coerce.number().min(0).optional().default(0)',
    why: 'the numeric default #2627 is about — a field pointer, so it must stay on the field',
  },
  {
    doc: 'docs/BASECRM/05-BUSINESS-FLOWS.md',
    cite: 'schemas.ts:245',
    src: 'lib/api/schemas.ts',
    line: 245,
    has: 'max(500)',
    why: 'the deals list ceiling — :243 is the schema, :245 is the clause quoted',
  },
  {
    doc: 'docs/BASECRM/05-BUSINESS-FLOWS.md',
    cite: 'schemas.ts:342',
    src: 'lib/api/schemas.ts',
    line: 342,
    has: 'max(200)',
    why: 'the leads list ceiling',
  },
  {
    doc: 'docs/BASECRM/05-BUSINESS-FLOWS.md',
    cite: 'schemas.ts:215',
    src: 'lib/api/schemas.ts',
    line: 215,
    has: 'max(200)',
    why: 'the contacts list ceiling',
  },
  {
    doc: 'docs/BASECRM/03-RBAC-AUTHZ.md',
    cite: 'field-permissions.ts:140',
    src: 'lib/rbac/field-permissions.ts',
    line: 140,
    has: '__clearFieldRestrictionsCache()',
    why: 'the invalidation call site the cache bullet names',
  },
  {
    doc: 'docs/BASECRM/06-REBUILD-GUIDE.md',
    cite: 'middleware.ts:432-442',
    src: 'lib/auth/middleware.ts',
    line: 437,
    has: 'export function requirePerm',
    why: 'the range covers both can() and requirePerm(), which is what step 6 claims',
  },
];

const docs = () =>
  readdirSync(join(ROOT, 'docs/BASECRM'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/BASECRM/${f}`);

describe('#3244 follow-up — pinned BASECRM citations resolve to what they name', () => {
  for (const p of PINNED) {
    it(`${p.doc} → ${p.cite} = ${p.src}:${p.line} "${p.has.slice(0, 40)}"`, () => {
      const docText = readFileSync(join(ROOT, p.doc), 'utf8');
      expect(docText, `${p.doc} no longer carries ${p.cite}`).toContain(p.cite);
      const lines = read(p.src);
      expect(lines.length, `${p.src} is shorter than the cited line`).toBeGreaterThanOrEqual(p.line);
      // Forward window of three lines: a doc that quotes a clause sitting on the
      // continuation of a wrapped call tolerates `:N` two lines early, but a pointer
      // whose content is *above* the cited line is a pointer that moved and must fail.
      const window = lines.slice(p.line - 1, p.line + 2).join('\n');
      expect(window, `${p.src}:${p.line} — ${p.why}`).toContain(p.has);
    });
  }

  it('no pinned pointer still cites the pre-drill numbers', () => {
    // Negative where the old number is gone from the file entirely…
    const stale = [
      ['docs/BASECRM/03-RBAC-AUTHZ.md', 'middleware.ts:341)'],
      ['docs/BASECRM/05-BUSINESS-FLOWS.md', 'resolve-stage.ts:117'],
    ];
    for (const [doc, needle] of stale) {
      expect(readFileSync(join(ROOT, doc), 'utf8'), `${doc} reverted to the stale ${needle}`).not.toContain(needle);
    }
    // …and positive where the drill keeps the superseded number on purpose, in the
    // `(was :X)` parenthetical this directory's convention requires: 02 still quotes
    // `core.ts:217…` as the mistake, so the check is that the *corrections* are there.
    const two = readFileSync(join(ROOT, 'docs/BASECRM/02-DATA-MODEL.md'), 'utf8');
    for (const fixed of ['core.ts:185', 'core.ts:379', 'core.ts:120']) {
      expect(two, `02 lost the ${fixed} correction`).toContain(fixed);
    }
  });
});

describe('#3244 follow-up — every citation in docs/BASECRM points inside its file', () => {
  // Resolvable `path/to/file.ext:NNN` citations; bare `foo.ts:NNN` shorthand is
  // covered by the PINNED pairs above, which resolve the directory by hand.
  const tracked = new Set<string>();
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.turbo', 'meta_backup']);
  const walk = (abs: string, rel = '') => {
    for (const e of readdirSync(abs)) {
      if (SKIP.has(e)) continue;
      const r = rel ? `${rel}/${e}` : e;
      const st = statSync(join(abs, e));
      if (st.isDirectory()) walk(join(abs, e), r);
      else tracked.add(r);
    }
  };

  // The one pointer that is *supposed* to be out of range: the docs cite
  // `rls.ts:372` to record that a rebuilder had been sent there and it never
  // existed. An allowlist of exactly this shape is the point — a new phantom has
  // to be added here by someone who read it.
  const INTENTIONAL_PHANTOMS = new Set(['lib/db/rls.ts:372']);

  walk(ROOT);
  // The docs' "Ref" tables name the owning directory in an adjacent column and
  // abbreviate the path in the citation cell (`deals/route.ts:160` under a
  // `app/api/tenant/deals/` header), so an unresolved token is not automatically a
  // broken pointer. Resolve by full path when the doc gave one, otherwise by the
  // unique-suffix match; only a token that matches no tracked file at all, or that
  // lands past EOF in *every* candidate, is a defect. An ambiguous abbreviation can
  // still be range-checked, which is the most this shape allows.
  const paths = [...tracked];
  const cache = new Map<string, number>();
  const lineCount = (p: string) => {
    let n = cache.get(p);
    if (n === undefined) {
      n = readFileSync(join(ROOT, p), 'utf8').split('\n').length;
      cache.set(p, n);
    }
    return n;
  };
  const resolve = (file: string): string[] => {
    if (tracked.has(file)) return [file];
    return paths.filter((p) => p.endsWith(`/${file}`));
  };
  // One place that decides "this citation is fine" so the leniency can be
  // negative-controlled below instead of only trusted.
  const defect = (doc: string, file: string, line: number): string | null => {
    if (INTENTIONAL_PHANTOMS.has(`${file}:${line}`)) return null;
    const cands = resolve(file);
    if (cands.length === 0) return `${doc}: ${file} is not a tracked file`;
    return cands.some((p) => lineCount(p) >= line)
      ? null
      : `${doc}: ${file}:${line} is past EOF in ${cands.join(', ')}`;
  };

  const found: Array<{ doc: string; file: string; line: number }> = [];
  for (const d of docs()) {
    const text = readFileSync(join(ROOT, d), 'utf8');
    for (const m of text.matchAll(/([A-Za-z0-9_\-./@]+\/[A-Za-z0-9_\-]+\.(?:ts|tsx|mts|mjs|sql|json)):(\d{1,4})/g)) {
      found.push({ doc: d, file: m[1], line: Number(m[2]) });
    }
  }

  it(`scans the citations it found (${found.length})`, () => {
    expect(found.length, 'the scanner found nothing to check — it broke, the docs did not').toBeGreaterThan(40);
  });

  it('points every citation at a tracked file and inside it', () => {
    const bad = found.map(({ doc, file, line }) => defect(doc, file, line)).filter(Boolean);
    expect(bad, `stale pointers:\n${bad.join('\n')}`).toEqual([]);
  });

  it('keeps the suffix leniency from going vacuous', () => {
    // The leniency above has a real cost: `bulk/route.ts` matches nine routes and
    // `deals/route.ts` three, because the docs' Ref tables name the owning
    // directory in an adjacent column (§ 2 of `05` is headed
    // `app/api/tenant/deals/`). So an abbreviated citation is range-checked against
    // *every* candidate and only fails when it is past EOF in all of them — weaker
    // than the full-path checks, and stated as such rather than glossed. What this
    // test guarantees is the floor: the resolver still refuses things that are not
    // files, and a line past EOF in every candidate is still a defect.
    const shorthand = found.filter(({ file }) => !tracked.has(file) && resolve(file).length > 1);
    expect(shorthand.length, 'no ambiguous shorthand exercised — the leniency is dead weight').toBeGreaterThan(0);
    expect(resolve('lib/db/thisFileDoesNotExist.ts')).toEqual([]);
    expect(defect('docs/BASECRM/02-DATA-MODEL.md', 'lib/db/nope.ts', 12)).toContain('not a tracked file');
    expect(defect('docs/BASECRM/02-DATA-MODEL.md', 'lib/db/pool.ts', 9_999)).toContain('past EOF');
    expect(defect('docs/BASECRM/02-DATA-MODEL.md', 'lib/db/pool.ts', 241)).toBeNull();
    // …and the one phantom that is on purpose stays allowed only while listed.
    expect(defect('docs/BASECRM/03-RBAC-AUTHZ.md', 'lib/db/rls.ts', 372)).toBeNull();
    expect(defect('docs/BASECRM/03-RBAC-AUTHZ.md', 'lib/db/rls.ts', 373)).not.toBeNull();
  });
});

describe('#3244 follow-up — the RLS policy claims 03 § 1 and 06 step 3 make', () => {
  const M37 = 'drizzle/migrations/0037_tenant_isolation_hardening.sql';
  const M39 = 'drizzle/migrations/0039_rls_fail_closed_policy.sql';

  it('0037 branches USING on nullability and pins a strict WITH CHECK', () => {
    const t = readFileSync(join(ROOT, M37), 'utf8');
    expect(t).toContain("using_expr := 'tenant_id::text = current_setting('");
    expect(t).toContain("using_expr := 'tenant_id IS NULL OR tenant_id::text = current_setting('");
    expect(t).toContain("WITH CHECK (tenant_id::text = current_setting('");
  });

  it('0039 is USING-only, unconditional, and NULLIF-guarded — so 0037 is not the shipped shape', () => {
    const t = readFileSync(join(ROOT, M39), 'utf8');
    expect(t).toContain('tenant_id IS NULL ');
    expect(t).toContain("NULLIF(current_setting(''app.current_tenant'', true), '''')");
    expect(t).not.toMatch(/WITH CHECK/);
    // one emitted policy for every table, no nullability branch
    expect((t.match(/CREATE POLICY tenant_isolation/g) ?? []).length).toBe(1);
  });

  it('states the USING-doubles-as-WITH-CHECK rule the docs rely on', () => {
    const t = readFileSync(join(ROOT, 'drizzle/migrations/0136_pre_auth_oauth_rls.sql'), 'utf8');
    expect(t.toLowerCase()).toContain('reuses its using clause as the check');
  });

  it('03 and 06 say which migration is being described instead of blending them', () => {
    const rls = readFileSync(join(ROOT, 'docs/BASECRM/03-RBAC-AUTHZ.md'), 'utf8');
    const rebuild = readFileSync(join(ROOT, 'docs/BASECRM/06-REBUILD-GUIDE.md'), 'utf8');
    expect(rls).toContain('0039:64-75');
    expect(rls).toContain('0037:239');
    expect(rls).toContain('0037:241');
    expect(rebuild).toContain('0039:64-75');
    expect(rebuild).toContain('USING-only');
    expect(rebuild).toContain('tenant_id` is NOT NULL');
  });

  // Migration coordinates are written `0037:239`, with no file extension, so the
  // generic citation scan cannot see them — yet a rebuilder follows them into a
  // DO-block whose line numbers move whenever the loop body is reformatted. Pinned
  // here as the same doc-carries-the-pointer / source-carries-the-clause pair.
  const MIG_CITES: Array<{ doc: string; cite: string; src: string; line: number; has: string }> = [
    { doc: 'docs/BASECRM/03-RBAC-AUTHZ.md', cite: '0037:239', src: M37, line: 239, has: "using_expr := 'tenant_id::text = current_setting('" },
    { doc: 'docs/BASECRM/03-RBAC-AUTHZ.md', cite: '0037:241', src: M37, line: 241, has: "using_expr := 'tenant_id IS NULL OR" },
    { doc: 'docs/BASECRM/03-RBAC-AUTHZ.md', cite: '0037:249', src: M37, line: 249, has: 'WITH CHECK (tenant_id::text = current_setting(' },
    { doc: 'docs/BASECRM/03-RBAC-AUTHZ.md', cite: '0136:45', src: 'drizzle/migrations/0136_pre_auth_oauth_rls.sql', line: 45, has: 'reuses its USING clause as the check' },
    { doc: 'docs/BASECRM/06-REBUILD-GUIDE.md', cite: '0039:64-75', src: M39, line: 65, has: 'CREATE POLICY tenant_isolation ON' },
  ];
  for (const c of MIG_CITES) {
    it(`${c.doc} carries ${c.cite} and ${c.src.split('/').pop()}:${c.line} still says it`, () => {
      expect(readFileSync(join(ROOT, c.doc), 'utf8'), `${c.doc} lost ${c.cite}`).toContain(c.cite);
      expect(read(c.src)[c.line - 1], `${c.src}:${c.line} no longer carries the clause`).toContain(c.has);
    });
  }
});

describe('#3244 follow-up — the reset-list count 02 quotes is the count the code has', () => {
  // Both lists are one long statement on one line, at the coordinates 02/03 cite:
  // the inline `pool.on('release')` reset at `pool.ts:241` and the
  // `RESET_TENANT_GUCS_SQL` string at `request-connection.ts:104`.
  const POOL_RESET: [string, number] = ['lib/db/pool.ts', 241];
  const RC_RESET: [string, number] = ['lib/db/request-connection.ts', 104];
  const configsAt = ([file, line]: [string, number]) =>
    (read(file)[line - 1].match(/set_config\(/g) ?? []).length;

  it('clears fourteen GUCs on each of the two lists', () => {
    expect(read(POOL_RESET[0])[POOL_RESET[1] - 1]).toContain("set_config('app.current_tenant'");
    expect(read(RC_RESET[0])[RC_RESET[1] - 1]).toContain('SELECT set_config(');
    const poolN = configsAt(POOL_RESET);
    const rcN = configsAt(RC_RESET);
    expect(poolN, `pool.ts:${POOL_RESET[1]} clears ${poolN}`).toBe(14);
    expect(rcN, `request-connection.ts:${RC_RESET[1]} clears ${rcN}`).toBe(14);
  });

  it('and 02 and 03 say fourteen, not a remembered smaller number', () => {
    for (const doc of ['docs/BASECRM/02-DATA-MODEL.md', 'docs/BASECRM/03-RBAC-AUTHZ.md']) {
      const t = readFileSync(join(ROOT, doc), 'utf8');
      expect(t, `${doc} dropped the fourteen claim`).toContain('fourteen');
      expect(t, `${doc} resurrects a stale count`).not.toMatch(/(twelve|thirteen) `?set_config/);
    }
  });
});
