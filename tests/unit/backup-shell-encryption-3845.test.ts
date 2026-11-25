import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, readFileSync as read, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = readFileSync(join(process.cwd(), 'deploy/scripts/backup.sh'), 'utf8');
const CLI = readFileSync(join(process.cwd(), 'scripts/backup/encrypt-file.mts'), 'utf8');
const PROD_ENV = readFileSync(join(process.cwd(), 'deploy/.env.production'), 'utf8');

describe('shell backup refuses to leave plaintext offsite (#3845)', () => {
  it('restricts the umask before creating anything', () => {
    const umaskIdx = SCRIPT.indexOf('umask 077');
    expect(umaskIdx).toBeGreaterThanOrEqual(0);
    expect(umaskIdx).toBeLessThan(SCRIPT.indexOf('mkdir -p "$BACKUP_DIR"'));
  });

  it('restricts the local dump to the owner', () => {
    expect(SCRIPT).toContain('chmod 600 "${BACKUP_DIR}/${BACKUP_FILE}"');
  });

  it('refuses a missing or template-placeholder encryption key', () => {
    expect(SCRIPT).toContain('BACKUP_ENCRYPTION_KEY is required for offsite backups');
    expect(SCRIPT).toContain('"$BACKUP_ENCRYPTION_KEY" != "<<<REQUIRED>>>"');
  });

  it('encrypts before the default offsite upload', () => {
    const encryptIdx = SCRIPT.indexOf('encrypt_for_upload()');
    const uploadIdx = SCRIPT.indexOf('*)         backup_local; encrypt_for_upload; upload_s3');
    expect(encryptIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(encryptIdx);
    expect(SCRIPT).toContain('npx --no-install tsx scripts/backup/encrypt-file.mts');
  });

  it('uploads the encrypted artefact, not the raw dump', () => {
    expect(SCRIPT).toContain('local upload_file="${ENCRYPTED_FILE:-$BACKUP_FILE}"');
    expect(SCRIPT).toContain('docker cp "${BACKUP_DIR}/${upload_file}"');
    expect(SCRIPT).toContain('ENCRYPTED_FILE="${BACKUP_FILE}.enc"');
  });

  it('declares the key in the production template', () => {
    expect(PROD_ENV).toContain('BACKUP_ENCRYPTION_KEY=<<<REQUIRED>>>');
  });

  it('reuses the same AES-GCM encryptor as the app backup service', () => {
    expect(CLI).toContain("import { encryptBackupFile } from '@/lib/backups/encrypt'");
  });
});

describe('encrypt-file CLI output is restorable by the app', () => {
  const key = 'test-backup-encryption-key-at-least-32-chars-long';
  const plaintextPath = join(tmpdir(), `nucrm-cli-3845-${process.pid}.dump`);
  const encryptedPath = `${plaintextPath}.enc`;
  const restoredPath = join(tmpdir(), `nucrm-cli-3845-restored-${process.pid}.dump`);

  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = key;
    writeFileSync(plaintextPath, 'CREATE TABLE tenants (id uuid);');
  });

  afterEach(() => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    for (const file of [plaintextPath, encryptedPath, restoredPath]) {
      if (existsSync(file)) rmSync(file);
    }
  });

  it('round-trips through encryptBackupFile and decryptBackupFile', async () => {
    const { encryptBackupFile, decryptBackupFile } = await import('@/lib/backups/encrypt');
    expect(await encryptBackupFile(plaintextPath)).toBe(encryptedPath);
    await decryptBackupFile(encryptedPath, restoredPath);
    expect(read(restoredPath, 'utf8')).toBe('CREATE TABLE tenants (id uuid);');
  });
});
