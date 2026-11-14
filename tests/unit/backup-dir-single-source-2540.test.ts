/**
 * #2540 — one backup directory, one precedence.
 *
 * The issue's comment measured four readers with four answers: the app writer
 * and `scripts/backup-db.ts` used `BACKUP_LOCAL_DIR` (default
 * `/tmp/nucrm-backups`), the health route used `BACKUP_DIR` (default
 * `/tmp/backups`), `scripts/backup-rls-live.sh` defaulted a third path, and
 * `scripts/backup-db.sh` overwrote the variable outright. On a host that set
 * only one name the health check could report an empty directory while dumps
 * were being written somewhere else.
 *
 * This pins the resolver and the readers, so the two cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_BACKUP_DIR, resolveBackupDir } from "../../lib/backups/paths";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("#2540 the backup directory has one name and one precedence", () => {
  it("defaults to the directory the app writer has always used", () => {
    expect(DEFAULT_BACKUP_DIR).toBe("/tmp/nucrm-backups");
    expect(resolveBackupDir({})).toBe("/tmp/nucrm-backups");
  });

  it("prefers BACKUP_LOCAL_DIR, then the legacy BACKUP_DIR", () => {
    expect(resolveBackupDir({ BACKUP_DIR: "/var/backups/nucrm" })).toBe(
      "/var/backups/nucrm",
    );
    expect(
      resolveBackupDir({
        BACKUP_LOCAL_DIR: "/srv/nucrm/backups",
        BACKUP_DIR: "/var/backups/nucrm",
      }),
    ).toBe("/srv/nucrm/backups");
  });

  it("treats an empty value as unset, not as the current directory", () => {
    expect(
      resolveBackupDir({
        BACKUP_LOCAL_DIR: "",
        BACKUP_DIR: "/var/backups/nucrm",
      }),
    ).toBe("/var/backups/nucrm");
    expect(resolveBackupDir({ BACKUP_LOCAL_DIR: "", BACKUP_DIR: "" })).toBe(
      "/tmp/nucrm-backups",
    );
  });

  it("never falls back to the health-only /tmp/backups directory", () => {
    // The old health route used this path and nothing wrote to it.
    expect(resolveBackupDir({})).not.toBe("/tmp/backups");
  });
});

describe("#2540 every reader goes through the resolver", () => {
  const readers = [
    "lib/backups/backup-service.ts",
    "app/api/cron/backup/route.ts",
    "app/api/superadmin/restore/route.ts",
    "app/api/system/health/route.ts",
  ];

  for (const path of readers) {
    it(`${path} resolves the shared directory`, () => {
      const source = read(path);
      expect(source).toContain("resolveBackupDir");
      // No reader may keep its own `X || 'literal'` decision.
      expect(source).not.toMatch(/BACKUP_LOCAL_DIR\s*\|\|\s*['"]/);
      expect(source).not.toMatch(/BACKUP_DIR\s*\|\|\s*['"]/);
    });
  }

  it("the standalone scripts import the same resolver", () => {
    for (const path of ["scripts/backup-db.ts", "scripts/deploy-migrate.ts"]) {
      const source = read(path);
      expect(source, path).toContain("from '../lib/backups/paths'");
      expect(source, path).toContain("resolveBackupDir()");
    }
  });

  it("the shell scripts read BACKUP_LOCAL_DIR before the legacy alias", () => {
    for (const path of [
      "scripts/backup-db.sh",
      "scripts/backup-rls-live.sh",
      "deploy/scripts/backup.sh",
      "deploy/scripts/infra-readiness.sh",
    ]) {
      const source = read(path);
      expect(source, path).toContain("BACKUP_LOCAL_DIR:-");
      expect(source, path).toContain("${BACKUP_DIR:-");
    }
  });

  it("backup-db.sh no longer overwrites an operator value with a hard-coded path", () => {
    const source = read("scripts/backup-db.sh");
    expect(source).not.toMatch(/^BACKUP_DIR="\/tmp\/nucrm-backups"$/m);
    expect(source).toContain(
      'BACKUP_DIR="${BACKUP_LOCAL_DIR:-${BACKUP_DIR:-/tmp/nucrm-backups}}"',
    );
  });
});

describe("#2540 the templates document the same contract", () => {
  it("env.example names BACKUP_LOCAL_DIR as canonical and BACKUP_DIR as legacy", () => {
    const source = read(".env.example");
    expect(source).toContain("BACKUP_LOCAL_DIR (above) is canonical");
    expect(source).toContain("BACKUP_DIR is the legacy");
    expect(source).toContain("BACKUP_LOCAL_DIR || BACKUP_DIR");
  });

  it("deploy/.env.production sets both names to the same durable directory", () => {
    const source = read("deploy/.env.production");
    expect(source).toContain("BACKUP_LOCAL_DIR=/var/backups/nucrm");
    expect(source).toContain("BACKUP_DIR=/var/backups/nucrm");
  });
});
