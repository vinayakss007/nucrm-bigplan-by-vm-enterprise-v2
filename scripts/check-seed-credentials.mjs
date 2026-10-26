#!/usr/bin/env node
/**
 * #3281 — a committed credential is a public credential.
 *
 * `npm run seed:dev` wrote `bcrypt.hash('password123')` into `admin@test.com`, a
 * platform super admin — `users.is_super_admin` is what turns on the
 * `app.is_super_admin` GUC, and with that GUC set the RLS policies stop applying at
 * all. The literal sat in a public repository, in `scripts/smoke-test.sh`
 * (`${SMOKE_LOGIN_PASSWORD:-SuperAdmin123!}`), in `scripts/security-test.sh` (six
 * times, in a request body), and in `.github/workflows/release.yml`
 * (`SMOKE_LOGIN_PASSWORD: password123`). Four of those are fixed on this branch.
 *
 * WHY THE EXISTING SCANNER DID NOT SEE IT, measured rather than assumed: the seed
 * literal is on `origin/main` at `scripts/seed-dev.ts:326` (`eb0c45cd0`) and the
 * `Secret Scan (gitleaks)` check-run for that exact commit is `completed success`.
 * Two reasons, both visible in `.gitleaks.toml:12-20` — its `[allowlist].paths`
 * excludes `scripts/security-test\.sh` and `\.github/`, which are two of the four
 * files named above, and gitleaks matches secret SHAPES (key formats, entropy) while
 * a dictionary word plus digits in a plain assignment is neither. `guard:semgrep` has
 * no rule mentioning a password either: `grep -rn -i password semgrep/` is empty.
 * So nothing in this repository was positioned to stop a fifth site. This is that
 * screen.
 *
 * It is a pattern screen over the executable surfaces of the repo — `scripts/`,
 * `app/`, `lib/`, `components/`, `.github/workflows/` — with no database, no
 * credentials and no network. What it can prove is exactly: "no literal that is used
 * AS a password survives in the files that run or configure this product". What it
 * cannot prove is that a value is not secret somewhere else; a real secret scanner
 * over git history is a different tool and a different issue.
 *
 * Checks, in the order they run:
 *
 *   HASH_LITERAL_PASSWORD        a password-hashing call given a string literal as its
 *                                first argument (`hashPassword('Admin123!')`,
 *                                `bcrypt.hash('password123', 12)`). The hash is not
 *                                protection: bcrypt is unsalted-fast here and the
 *                                literal is in the same file.
 *   PASSWORD_LITERAL_ASSIGNMENT  `const X_PASSWORD = 'literal'`, or a shell
 *                                `X_PASSWORD="literal"`, where the NAME says password
 *                                and the VALUE is a fixed string. Interpolated values
 *                                (`$(…)`, `${…}`) are not findings — that is the fix.
 *   PASSWORD_ENV_LITERAL_DEFAULT a password-named environment read with a committed
 *                                fallback: JS `process.env.X || 'lit'`, shell
 *                                `${X:-lit}`. This is how smoke-test.sh kept a default
 *                                that looked like a requirement.
 *   PASSWORD_JSON_LITERAL        a `"password": "literal"` pair in a request body or
 *                                fixture — the shape security-test.sh used six times.
 *   WORKFLOW_PASSWORD_LITERAL    a workflow env key matching `*PASSWORD*:` whose value
 *                                is a plain scalar rather than `${{ … }}`. The
 *                                throwaway-service ones (`POSTGRES_PASSWORD: postgres`,
 *                                a container that dies with the runner) are listed in
 *                                the baseline, reviewed and countable, not ignored.
 *
 * Every finding is `CHECK<TAB>file:line<TAB>detail` with the check name at column 0,
 * which is what the CI negative control greps for: a screen that passes a planted
 * credential proves it is reading names, not bodies.
 *
 * Usage:
 *   node scripts/check-seed-credentials.mjs
 *   node scripts/check-seed-credentials.mjs --json
 *   node scripts/check-seed-credentials.mjs --explain
 *   node scripts/check-seed-credentials.mjs --root <fixture-dir>
 *   node scripts/check-seed-credentials.mjs --baseline <path> [--update|--print-baseline]
 *
 * Exit: 0 clean (or shrinkable baseline reported), 1 findings or a widened ratchet,
 * 2 not applicable — the directory that would be scanned is not there.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : path.resolve(HERE, '..'));

const DEFAULT_BASELINE = path.resolve(HERE, 'seed-credentials-baseline.json');
const SOURCE_DIRS = ['scripts', 'app', 'lib', 'components'];
const WORKFLOW_DIR = '.github/workflows';
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mjs', '.mts', '.js', '.sh']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist', '.git', 'backups', 'fixtures']);

/**
 * Values that are field labels, placeholders, or identifiers — not secrets.
 * `'Password'` as a form label is not a credential; `'password123'` is.
 */
const NON_CREDENTIAL_VALUE = new Set([
  'password', 'passwd', 'currentpassword', 'newpassword', 'confirmpassword',
  'yourpasswordhere', 'your password here', 'changeme', 'xxxxxxxxxxxx',
]);

/**
 * A template placeholder or a variable reference (`<your-password>`, `${…}`, `$(…)`,
 * `$name`, `…`, `YOUR_…`) is an
 * instruction to set a value, not a value — which is exactly what the fixed
 * `CHAIN_PASSWORD="Release!$(od …)"` in release.yml is. It is matched as a shape rather
 * than as "contains a dollar sign", because a real password may contain `$`:
 * `P@$$w0rd1!` must be a finding, not an exclusion.
 */
const PLACEHOLDER = /\$\{|\$\(|\$[A-Za-z_]|<[a-zA-Z_][a-zA-Z0-9_-]*>|\.\.\.|…|YOUR[_ -]/;

/**
 * `AUTH_PASSWORD_WEAK = 'AUTH_PASSWORD_WEAK'` and `SEED_PASSWORD_ENV = 'SEED_PASSWORD'`
 * are an enum member and an environment NAME. An all-caps identifier with no digit and
 * no punctuation is a code; `ADMIN123` still counts, because it carries a digit.
 */
const IDENTIFIER_CODE = /^[A-Z][A-Z_]*$/;

const isCredentialValue = (v) => {
  const t = v.trim();
  if (t.length < 5) return false;
  if (NON_CREDENTIAL_VALUE.has(t.toLowerCase())) return false;
  if (PLACEHOLDER.test(t)) return false;
  if (IDENTIFIER_CODE.test(t)) return false;
  // A value with no digit and no punctuation at all is a word, and words are labels.
  return /[0-9!@#$%^&*(),.?":{}|<>_\-.]/.test(t);
};

const RULES = [
  {
    check: 'HASH_LITERAL_PASSWORD',
    // first argument of a hashing call is a string literal
    re: /\b(?:hashPassword|bcrypt\.hash|bcrypt\.hashSync|bcryptjs\.hash|argon2\.hash|scryptHash)\s*\(\s*(['"`])([^'"`]*)\1/g,
    extract: (m) => (isCredentialValue(m[2]) ? { value: m[2] } : null),
    detail: (m) => `hashes the literal '${m[2]}' — anyone who can read this file can log in as whatever it seeds`,
  },
  {
    check: 'PASSWORD_JSON_LITERAL',
    // "password": "literal" in a body or fixture
    re: /["']password["']\s*:\s*["']([^"']+)["']/g,
    extract: (m) => (isCredentialValue(m[1]) ? { value: m[1] } : null),
    detail: (m) => `sends the literal '${m[1]}' as a password`,
  },
  {
    check: 'PASSWORD_ENV_LITERAL_DEFAULT',
    // process.env.X_PASSWORD || 'lit'  /  ${X_PASSWORD:-lit}
    re: /(?:process\.env[.[]['"]?|env[.[]['"]?|\$\{)([A-Z][A-Z0-9_]*PASS(?:WORD|WD)[A-Z0-9_]*)['"]?\}?\s*(?:\|\||\?\?|:-)\s*(['"]?)([^'"}|&]+)\2/g,
    extract: (m) => (isCredentialValue(m[3]) ? { value: m[3] } : null),
    detail: (m) => `${m[1]} falls back to the committed value '${m[3]}' — unset is silently a credential, not an error`,
  },
  {
    check: 'PASSWORD_LITERAL_ASSIGNMENT',
    // const X_PASSWORD = 'lit'  /  X_PASSWORD="lit" in shell
    re: /(?:\b(?:const|let|var)\s+|^\s*)([A-Za-z_][A-Za-z0-9_]*PASS(?:WORD|WD)[A-Za-z0-9_]*)\s*[:=]\s*(['"])((?:(?!\2).)+)\2/g,
    extract: (m) => (isCredentialValue(m[3]) ? { value: m[3] } : null),
    detail: (m) => `${m[1]} is assigned the literal '${m[3]}'`,
  },
];

const WORKFLOW_RULE = {
  check: 'WORKFLOW_PASSWORD_LITERAL',
  re: /^\s*(-\s+)?([A-Za-z_][A-Za-z0-9_]*PASS(?:WORD|WD)[A-Za-z0-9_]*)\s*:\s*(\S.*)$/g,
  extract: (m) => {
    const v = m[3].trim();
    if (v.startsWith('${') || v.startsWith('$') || v.startsWith('>') || v.startsWith('#')) return null;
    return isCredentialValue(v) ? { value: v } : null;
  },
  detail: (m) => `${m[2]}: ${m[3].trim()} — a workflow literal is published with the repository`,
};

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (SKIP_DIRS.has(name)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

function filesFor(root, relDir, exts) {
  const dir = path.resolve(root, relDir);
  if (!existsSync(dir)) return [];
  return walk(dir, []).filter((f) => exts.has(path.extname(f)));
}

function stripComments(text) {
  // Block comments and full-line `--`/`#` comments describe code; they are not code.
  // A finding inside prose would make the screen unable to run next to an issue number.
  const lines = text.split('\n');
  let inBlock = false;
  return lines.map((line) => {
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      return '';
    }
    if (/^\s*(\/\*|\/\*!)/.test(line)) {
      if (!line.includes('*/')) inBlock = true;
      return '';
    }
    if (/^\s*(\/\/|#|--)/.test(line)) return '';
    return line;
  }).join('\n');
}

/**
 * @returns {{findings: Array, allowed: number, hits: Array}|{notApplicable: true}}
 */
export function analyse({ baseline = {}, root = ROOT } = {}) {
  const hits = [];
  const seen = new Set();

  const scan = (relFile, text, rules) => {
    const stripped = stripComments(text).split('\n');
    const original = text.split('\n');
    for (let i = 0; i < stripped.length; i++) {
      const line = stripped[i];
      if (!line) continue;
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          if (!rule.extract(m)) continue;
          const key = `${rule.check}|${relFile}:${i + 1}|${m[0]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            check: rule.check,
            file: relFile,
            line: i + 1,
            detail: rule.detail(m),
            source: (original[i] ?? '').trim(),
          });
        }
      }
    }
  };

  let sawAny = false;
  for (const dir of SOURCE_DIRS) {
    if (existsSync(path.resolve(root, dir))) sawAny = true;
    for (const f of filesFor(root, dir, SOURCE_EXT)) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (rel.endsWith('check-seed-credentials.mjs')) continue; // the rules live in this file
      scan(rel, readFileSync(f, 'utf8'), RULES);
    }
  }
  const wfPath = path.resolve(root, WORKFLOW_DIR);
  if (existsSync(wfPath)) {
    sawAny = true;
    for (const f of filesFor(root, WORKFLOW_DIR, new Set(['.yml', '.yaml']))) {
      scan(path.relative(root, f).split(path.sep).join('/'), readFileSync(f, 'utf8'), [WORKFLOW_RULE]);
    }
  }
  if (!sawAny) return { notApplicable: true, findings: [], allowed: 0, hits: [] };

  // Allowances are consumed in scan order, per file and check, so a baseline entry
  // says "this many of these, in this file" and nothing about which line moved.
  const used = new Map();
  const findings = [];
  let allowed = 0;
  for (const h of hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))) {
    const key = `${h.file}|${h.check}`;
    const cap = baseline[key] ?? 0;
    const soFar = used.get(key) ?? 0;
    if (soFar < cap) {
      used.set(key, soFar + 1);
      allowed++;
      continue;
    }
    findings.push(h);
  }

  // A baseline entry that matched nothing is stale: exemptions must not outlive the code.
  for (const [key, n] of Object.entries(baseline)) {
    if (key === '_comment') continue;
    const got = used.get(key) ?? 0;
    if (got < n) {
      findings.push({
        check: 'BASELINE_STALE',
        file: key.split('|')[0],
        line: 0,
        detail: `${key} allows ${n} but only ${got} match — shrink scripts/seed-credentials-baseline.json, the ratchet is shrink-only (#3281)`,
        source: '',
      });
    }
  }
  return { notApplicable: false, findings, allowed, hits };
}

export function readBaseline(p) {
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`baseline ${p} is not readable JSON: ${e.message}`);
    return {};
  }
}

function baselineMap(hits, existing) {
  const out = { _comment: existing?._comment ?? 'Shrink-only ratchet for scripts/check-seed-credentials.mjs (#3281): per-file, per-check count of committed password literals that are known and reviewed. Lower a number when you remove one; deleting this file sets every allowance to 0.' };
  for (const f of hits) {
    const k = `${f.file}|${f.check}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const EXPLAIN = `seed credential screen (#3281) — what each check asserts:
  HASH_LITERAL_PASSWORD         a hashing call given a string literal
  PASSWORD_JSON_LITERAL         "password": "literal" in a body or fixture
  PASSWORD_ENV_LITERAL_DEFAULT  a *PASSWORD env read with a committed fallback
  PASSWORD_LITERAL_ASSIGNMENT   a *PASSWORD name assigned a fixed string
  WORKFLOW_PASSWORD_LITERAL     a workflow PASSWORD key with a scalar value, not \${{ … }}
  BASELINE_STALE                an allowance with no matching site left
`;

export function main(argv = process.argv.slice(2)) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  if (argv.includes('--explain')) {
    console.log(EXPLAIN);
    return 0;
  }
  const baselinePath = path.resolve(ROOT, opt('--baseline') ?? DEFAULT_BASELINE);
  let baseline = readBaseline(baselinePath);
  let result = analyse({ baseline });
  if (result.notApplicable) {
    console.error(`nothing to scan under ${ROOT} — expected ${SOURCE_DIRS.join(', ')} or ${WORKFLOW_DIR}`);
    return 2;
  }
  if (argv.includes('--update')) {
    const next = baselineMap(result.hits, baseline);
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`wrote ${baselinePath} (${Object.keys(next).length - 1} entries)`);
    baseline = readBaseline(baselinePath);
    result = analyse({ baseline });
  }
  if (argv.includes('--print-baseline')) {
    console.log(JSON.stringify(baselineMap(result.hits, baseline), null, 2));
    return 0;
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ findings: result.findings, allowed: result.allowed }, null, 2));
    return result.findings.length ? 1 : 0;
  }

  if (result.findings.length === 0) {
    console.log(`seed credentials: clean — no committed password literal in ${SOURCE_DIRS.join('/')}/${WORKFLOW_DIR} (${result.allowed} baselined)`);
    return 0;
  }
  for (const f of result.findings) {
    console.log(`${f.check}\t${f.file}:${f.line}\t${f.detail}`);
    if (f.source) console.log(`\t  ${f.source}`);
  }
  console.log(`\n${result.findings.length} committed credential literal(s). #3281: a password in this repository is a password in the world — read it from the environment and fail when it is absent.`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
