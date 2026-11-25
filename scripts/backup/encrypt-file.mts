import { encryptBackupFile } from '@/lib/backups/encrypt';

const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: encrypt-file.mts <path-to-dump>\n');
  process.exit(1);
}

encryptBackupFile(file)
  .then((encryptedPath) => process.stdout.write(`${encryptedPath}\n`))
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
