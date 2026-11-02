import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Options each S3Client was constructed with, in call order. */
const built: Record<string, unknown>[] = [];

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class PutObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class DeleteObjectsCommand extends Command {}
  class HeadBucketCommand extends Command {}
  class CreateBucketCommand extends Command {}
  class S3Client {
    constructor(config: Record<string, unknown>) {
      built.push(config);
    }
    async send(cmd: Command) {
      if (cmd instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: false };
      return {};
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
    HeadBucketCommand,
    CreateBucketCommand,
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('dump-bytes')),
  writeFile: vi.fn(async () => undefined),
}));

const ENV_VARS = [
  'S3_ACCESS_KEY_ID', 'S3_ACCESS_KEY', 'AWS_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY', 'S3_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET', 'BACKUP_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_FORCE_PATH_STYLE',
] as const;

const ROOT = join(__dirname, '..', '..');

/** Names a module can spell the SDK constructor with: `S3Client`, `… as Foo`, `…: Foo`. */
function clientNames(source: string): string[] {
  const names = new Set<string>();
  const specifiers = /(?:import|const)\s*\{([^}]*)\}\s*(?:=|from)\s*\(?\s*['"]@aws-sdk\/client-s3['"]/g;
  for (const clause of [...source.matchAll(specifiers)].flatMap((m) => m[1].split(','))) {
    const [bound, local] = clause.trim().split(/\s+(?:as|:)\s+/);
    if (bound === 'S3Client') names.add(local ?? 'S3Client');
  }
  return [...names];
}

/** The argument text of every client construction, taken up to the matching paren. */
function clientConstructionArgs(source: string): string[] {
  const args: string[] = [];
  for (const name of clientNames(source)) {
    const needle = `new ${name}(`;
    for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
      let depth = 1;
      let i = at + needle.length;
      for (; i < source.length && depth > 0; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') depth -= 1;
      }
      args.push(source.slice(at + needle.length, i - 1));
    }
  }
  return args;
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, found);
    else if (/.(ts|mts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

describe('#3387 — one addressing style for every S3 client', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    built.length = 0;
    saved = {};
    for (const name of ENV_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  async function resolver() {
    return import('@/lib/storage/s3-client');
  }

  describe('the policy', () => {
    it('is path style when the operator said nothing', async () => {
      const { s3ClientOptions } = await resolver();
      expect(s3ClientOptions({ region: 'us-east-1' }).forcePathStyle).toBe(true);
    });

    it('takes the opt-out in whichever shape an operator writes it', async () => {
      const { pathStyleFromEnv } = await resolver();
      for (const off of ['false', 'FALSE', ' false ', '0', 'off', 'no']) {
        process.env.S3_FORCE_PATH_STYLE = off;
        expect(pathStyleFromEnv()).toBe(false);
      }
    });

    it('does not treat an unrecognised value as an opt-out', async () => {
      const { pathStyleFromEnv } = await resolver();
      for (const keep of ['true', 'yes', 'never', '', '   ']) {
        process.env.S3_FORCE_PATH_STYLE = keep;
        expect(pathStyleFromEnv()).toBe(true);
      }
    });

    it('leaves a decision the caller already made alone', async () => {
      const { s3ClientOptions } = await resolver();
      expect(s3ClientOptions({ forcePathStyle: false }).forcePathStyle).toBe(false);
    });

    it('carries region, endpoint and credentials through, defaulting the region', async () => {
      const { s3ClientOptions } = await resolver();
      const cfg = {
        region: 'auto',
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'ak', secretAccessKey: 'sh' },
      };
      expect(s3ClientOptions(cfg)).toEqual({
        region: 'auto',
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'ak', secretAccessKey: 'sh' },
        forcePathStyle: true,
      });
      expect(s3ClientOptions({}).region).toBe('us-east-1');
    });
  });

  describe('what the SDK is actually handed', () => {
    it('constructs with the resolved addressing, not the SDK default', async () => {
      const { createS3Client } = await resolver();
      await createS3Client({ region: 'us-east-1', endpoint: 'http://minio:9000' });
      expect(built[0]).toMatchObject({ endpoint: 'http://minio:9000', forcePathStyle: true });
    });

    it('honours the opt-out all the way to the constructor', async () => {
      process.env.S3_FORCE_PATH_STYLE = 'false';
      const { createS3Client } = await resolver();
      await createS3Client({ region: 'us-east-1' });
      expect(built[0]).toMatchObject({ forcePathStyle: false });
    });
  });

  describe('the backup paths that were the failure (#3387)', () => {
    beforeEach(() => {
      process.env.S3_ACCESS_KEY = 'access';
      process.env.S3_SECRET_KEY = 'secret';
      process.env.S3_BUCKET = 'nucrm-backups';
      process.env.S3_ENDPOINT = 'http://minio:9000';
    });

    it('uploads the nightly dump to host/bucket, not bucket.host', async () => {
      const offsite = await import('@/lib/backups/offsite');
      await offsite.uploadBackupArtifact({ localPath: '/tmp/x.dump', filename: 'x.dump' });
      expect(built[0]).toMatchObject({ forcePathStyle: true, endpoint: 'http://minio:9000' });
    });

    it('purges retention from the same address it listed', async () => {
      const offsite = await import('@/lib/backups/offsite');
      await offsite.purgeExpiredBackups(730);
      const { s3ClientOptions } = await resolver();
      expect(built[0]?.forcePathStyle).toBe(s3ClientOptions().forcePathStyle);
    });

    it('keeps the files module on the policy it already had', async () => {
      process.env.S3_BUCKET = 'nucrm-user-files';
      const mod = await import('@/lib/storage/s3');
      expect(mod).toBeTruthy();
      expect(built.some((cfg) => cfg.forcePathStyle === true)).toBe(true);
    });
  });

  describe('ratchet: no module chooses transport options for itself', () => {
    const dirs = ['app', 'lib', 'scripts', 'components'];
    const RESOLVER = 'lib/storage/s3-client.ts';

    function sources(): { file: string; text: string }[] {
      const out: { file: string; text: string }[] = [];
      for (const dir of dirs) {
        for (const abs of walk(join(ROOT, dir))) {
          const file = abs.slice(ROOT.length + 1);
          if (file === RESOLVER) continue;
          out.push({ file, text: readFileSync(abs, 'utf8') });
        }
      }
      return out;
    }

    it('no client is constructed from an inline option object', () => {
      const inline = sources().flatMap(({ file, text }) =>
        clientConstructionArgs(text)
          .filter((args) => !args.includes('s3ClientOptions(') || args.includes('forcePathStyle:'))
          .map((args) => `${file}: ${args.slice(0, 60)}`),
      );
      expect(inline).toEqual([]);
      // The scan would pass vacuously if every site disappeared.
      expect(sources().reduce((n, s) => n + clientConstructionArgs(s.text).length, 0)).toBeGreaterThan(0);
    });

    it('every module that builds a client reaches for the resolution too', () => {
      // Command-only modules (lib/storage/ensure-bucket.ts and its callers)
      // legitimately import the SDK without constructing anything, so the rule is
      // about the constructor, not the import.
      const drifters = sources()
        .filter(({ text }) => clientConstructionArgs(text).length > 0)
        .filter(({ text }) => !/['"]@\/?lib\/storage\/s3-client['"]|['"]\.\.\/lib\/storage\/s3-client['"]|['"]\.\/s3-client['"]/.test(text))
        .map(({ file }) => file);
      expect(drifters).toEqual([]);
      const resolvers = sources().filter(({ text }) => /s3-client['"]/.test(text));
      expect(resolvers.length).toBeGreaterThanOrEqual(8);
    });
  });
});
