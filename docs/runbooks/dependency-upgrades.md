# Dependency Upgrade Runbook

How to upgrade packages in this repo without breaking it, and how to respond
when a CVE lands. Companion to
[`docs/planning/MAINTENANCE_UPDATE_GUIDE.md`](../planning/MAINTENANCE_UPDATE_GUIDE.md),
which covers the *what* (Sentry, schema, release cadence); this file covers the
*how* for dependencies, and is where the `overrides` rules live.

Everything marked **verified** below was tested against this repo's registry
state on 2026-10-23 in a throwaway project, not recalled from memory.

---

## 1. Know which surface you are upgrading

Three separate surfaces, three different risk profiles. Do not treat them as one
"npm update".

| Surface | Where it lives | Blast radius |
| --- | --- | --- |
| **Runtime** | `Dockerfile` base image, `package.json` `engines`, `.github/workflows/ci.yml` `node-version`, the dev box | Affects every request; a Node CVE is not fixed by `npm audit` |
| **Production deps** | `dependencies` — shipped into the runner image | Reachable by attackers at runtime |
| **Build / lint / test** | `devDependencies` — used in CI and the Docker *builder* stage only | Usually DoS/complexity only, never network-reachable |

Check which graph a finding is in before deciding how fast to move:

```bash
npm audit --omit=dev      # what actually ships to production
npm audit                 # everything, including dev tooling
```

A vulnerability in `eslint`'s transitive tree is not an emergency. The same
advisory count in both outputs means it is in the shipped graph — that one is.

**Trap specific to this repo:** `@next/eslint-plugin-next` is declared in
`dependencies` (`package.json:166`), so `npm audit --omit=dev` still drags
`eslint-config-next -> fast-glob -> micromatch -> braces` into the production
graph. Lint tooling that belongs in `devDependencies` inflates every prod audit
you will ever run.

---

## 2. Ground rules

1. **Never run `npm audit fix --force` unprompted.** It resolves to the newest
   major it is willing to jump. In this repo that means `tailwindcss 3.4.19 -> 4.3.3`
   — a full restructure of `tailwind.config` and every `@apply` — silently, inside
   a "security fix". `--force` is a major-upgrade decision disguised as a patch.
2. **One issue per PR** (AGENTS.md). Do not mix a CVE override with a monthly
   minor bump; the reviewer cannot bisect a break across the two.
3. **Branch from `main`**, name it `fix/<thing>` or `chore/deps-<thing>`. Never
   commit to `main`.
4. **Never `git add -A`** in this repo when another agent may be mid-task; stage
   `package.json` and `package-lock.json` explicitly.
5. **Never run two `npm run build`s concurrently** — it corrupts `.next` with
   `.external` module-not-found errors. `rm -rf .next` before a clean rebuild.

---

## 3. Standard procedure (patch/minor, or a CVE with a same-line fix)

```bash
# 0. Confirm the tree is clean and nobody else is working in it
git status --short
git stash list | wc -l

# 1. Branch from main
git checkout main && git pull
git checkout -b chore/deps-<package>-<version>

# 2. Record the before-state, so the PR can show exactly what moved
npm ls <pkg> > /tmp/before.txt 2>&1
node -e 'const l=require("./package-lock.json");console.log(Object.entries(l.packages).filter(([k])=>k.endsWith("/<pkg>")).map(([k,v])=>k+" "+v.version).join("\n"))'

# 3. Change package.json by hand (or the overrides block, see section 4)
#    Do NOT let a bot pick a range you have not read.

# 4. Install and re-resolve the lockfile
npm install

# 5. Prove the vulnerable copy is gone, and that nothing is "invalid"
npm ls <pkg> 2>&1 | grep -i invalid || echo "tree clean"
npm audit --omit=dev
node -e 'const l=require("./package-lock.json");console.log(Object.entries(l.packages).filter(([k])=>k.endsWith("/<pkg>")).map(([k,v])=>k+" "+v.version).join("\n"))'

# 6. Verify behaviour, not just install success
npm run typecheck
npm run test:unit
npm run build

# 7. Stage explicitly, commit, PR against main
git add package.json package-lock.json
git commit -m "fix(#<issue>): <package> <old> -> <new> (<GHSA-id>)"
```

If step 5 shows `invalid: "..."` anywhere, the change is not done. That string
means an `overrides` entry is fighting what a parent package actually asked for,
and npm installed something nobody declared. See section 4.

---

## 4. `overrides` — the rules that matter

The `overrides` block in `package.json:266` exists to force patched versions of
transitive packages we do not control. Used wrong it either pins the vulnerable
version or hands every consumer an incompatible major. All four rules below were
verified empirically.

### Rule 1 — a top-level override REPLACES the requested range, for every copy

It is not intersected with what the parent asked for. npm then resolves the
highest version satisfying your override, wherever that lands in the tree.

**Verified failure mode:** overriding `brace-expansion` to a range that permits
`5.x` gives `minimatch@3.1.5` (which declares `^2.0.0`) a copy of
`brace-expansion@5.0.12`. It installs cleanly and reports no conflict. Then it
throws at runtime, because the export shape changed:

```
brace-expansion@2  module.exports = function expand(str)      -> typeof "function"
brace-expansion@5  module.exports = { EXPANSION_MAX, expand } -> typeof "object"

minimatch('foo.js', '{foo,bar}.js')
  TypeError: expand is not a function
```

`npm ls` and `npm install` will both look happy. Only a runtime call finds it.
So: after any override change, **exercise the consumer**, do not trust a green
install.

### Rule 2 — scope an override to the parent (and version line) that needs it

Version-scoped parent keys work, are honored, and do not leak to other copies.
**Verified:**

```json
"overrides": {
  "minimatch@10": { "brace-expansion": "^5.0.12" }
}
```

resolves `brace-expansion@5.0.12` under `minimatch@10.2.6` while
`readdir-glob -> minimatch@5.1.9` keeps its own `brace-expansion@2.1.7`. Both
lines satisfied, no `invalid` entries. (Confirmed by pinning the override to an
exact lower version `5.0.5` and seeing npm honor it rather than picking the
highest available.)

Reach for this form whenever one version line needs a bump and another must not
move.

### Rule 3 — you cannot target a package that is also a direct dependency

**Verified:** with `minimatch` in `dependencies`, the key `"minimatch@3"` fails:

```
npm error code EOVERRIDE
npm error Override for minimatch@3.1.5 conflicts with direct dependency
```

If you need that, bump the direct dependency itself and let its range resolve.

### Rule 4 — check the override's floor against the advisory's *range*

A caret range is not "safe". `"fast-uri": "^3.1.6"` reads as "3.1.6 or newer",
but it admits 3.1.6 and 3.1.7 — and the advisory covers **3.0.0 through 3.1.7**.
The override was pinning the vulnerable version it was written to avoid.
Patch within the line for `fast-uri` is `3.1.9`; the override must floor at or
above it.

Same class of bug, different direction: `"brace-expansion": "^2.1.4"` can never
satisfy `minimatch@10`, which wants `^5.0.8`. npm installs `5.0.9` and marks it
`invalid`, so every `npm ci` in CI produces a technically invalid tree that
everyone has learned to ignore.

### When an override cannot help

If the advisory range is `*` (every published version), there is no patched
release to force and overrides are useless. The only fixes are to remove the
dependency from the shipped graph, or replace the package. `braces`
(GHSA-vfj7-8cjw-p6xm) is in that state: `3.0.3` is the latest publish and is
still affected; upstream's own advice is to move to `tailwindcss@4`, which drops
the `chokidar`/`micromatch`/`braces` chain entirely.

---

## 5. Node runtime upgrades

`npm audit` will never tell you your Node is vulnerable. The runtime is a
separate check, and it is the one with the RCE in it.

```bash
node -v                                                    # local
grep -n "FROM node" Dockerfile                             # image
grep -rn "node-version" .github/workflows/*.yml            # CI
```

Two different kinds of Node change:

**Patch / security release** (22.23.3 -> 22.23.4). No API change, no rebuild of
native modules. Just update the box, and confirm the base image tag resolves to
at least the patched version. Floating major tags (`node:26-alpine`,
`node-version: "22"`) pick the newest patch automatically on the next build,
which is good for security and bad for reproducibility — pin `node:26.12.1-alpine`
in `Dockerfile` once you want a build you can prove, and let Dependabot's
`docker` ecosystem bump it.

**Major** (24 -> 26). Treat as a project: update `engines`, `Dockerfile` (all
three stages), every `node-version` in `.github/workflows/`, local `nvm`, then
`rm -rf node_modules && npm install` because native/optional bindings rebuild
(`@rolldown/binding-linux-x64-gnu` is an `optionalDependency` here), then full
tests plus a staging deploy.

Keep `@types/node` on the same major as the *lowest* runtime you support, or
typecheck will accept APIs that throw at runtime. This repo currently types
against Node 26 (`@types/node@26.6.5`) while CI runs 22 and dev runs 24.

Watch `engines` closely: `">=22.0.0"` is a floor that permits every unpatched
22.x. When a security release lands, raise floors to the patched version
(`">=22.23.4"`) rather than rewriting the range.

---

## 6. Major upgrades (tailwind 3->4, ioredis 5->6, recharts 2->3, typescript 7)

Never inside a CVE PR. Separate branch, and:

1. Read the framework migration guide before touching code.
2. One major per PR — never two majors, or a failure is unattributable.
3. Expect real code changes: `tailwindcss@4` replaces the config file with CSS
   `@theme`; `typescript@7` is a new compiler line and will surface latent
   errors across a codebase this size.
4. `npm outdated` reports "Latest" — for `@types/bcryptjs`, `@types/dompurify`
   and `@types/uuid` that column is *lower* than what is installed. Those are
   deprecated stub packages; the real packages ship their own types now. Delete
   the stubs rather than chasing them.
5. `.github/dependabot.yml` deliberately ignores majors for `next`, `react`,
   `react-dom`, `drizzle-orm`, `typescript`. Respect that: a human opens those.

---

## 7. Rollback

`package-lock.json` is the unit of rollback, not `package.json`:

```bash
git checkout main -- package.json package-lock.json
rm -rf node_modules .next && npm ci
```

If a bad override shipped, fix the override, `npm install` to regenerate the
lock, and confirm with `npm ls <pkg> 2>&1 | grep -i invalid`.

---

## 8. Current known-open state (measured 2026-10-23)

Useful as a worked example of every category above. Re-measure before acting —
this goes stale in days.

| Finding | Where | Fix | Notes |
| --- | --- | --- | --- |
| Node 24.21.0 on the dev box | runtime | -> 24.22.1 | Oct 21 2026 release, incl. Brotli RCE CVE-2026-111497 |
| `engine.io@6.6.9` high DoS | prod (`realtime` container, nginx-proxied `/socket.io/`) | `"engine.io": "^6.6.11"` | socket.io 4.8.4 caps it; unauthenticated, highest priority |
| `fast-uri@3.1.6` high | dev tooling (lighthouse/ajv) | override `^3.1.9` | current `^3.1.6` admits the vulnerable versions |
| `brace-expansion@5.0.9` high + `invalid` tree | dev (eslint) | `"minimatch@10": {"brace-expansion": "^5.0.12"}` | do **not** blanket-override; see Rule 1 |
| `braces` high, range `*` | prod, via lint deps | no upstream fix | remove `@next/eslint-plugin-next` from `dependencies`, or Tailwind v4 |
| `postcss-selector-parser <7.1.6` moderate | build | 7.1.7 available | build-time CPU only |
| `@next/eslint-plugin-next` in `dependencies` | packaging | move to devDependencies | fixes the prod-graph inflation above |
| `packageManager: npm@11.19.1` vs box `11.19.0` | toolchain | align | corepack mismatch |

Verified clean as of the same date: `next@16.4.2` is latest and already contains
the Oct 14 out-of-band fixes for the two critical unauthenticated RCEs;
`react@19.3.1` is latest.
