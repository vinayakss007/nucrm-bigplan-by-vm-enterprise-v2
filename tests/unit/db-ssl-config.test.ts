import { describe, it, expect } from 'vitest';
import { pgSslConfig } from '@/lib/db/ssl-config';

describe('pgSslConfig', () => {
  it('is on by default, so an unset DATABASE_SSL does not mean plaintext', () => {
    expect(pgSslConfig({})).not.toBe(false);
  });

  it('verifies the server certificate in production', () => {
    expect(pgSslConfig({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true });
  });

  it('does not verify outside production, where certs are usually self-signed', () => {
    expect(pgSslConfig({ NODE_ENV: 'development' })).toEqual({ rejectUnauthorized: false });
    expect(pgSslConfig({ NODE_ENV: 'test' })).toEqual({ rejectUnauthorized: false });
  });

  it('disables TLS only for the exact string "false"', () => {
    expect(pgSslConfig({ DATABASE_SSL: 'false' })).toBe(false);
    // Anything else must not be read as "off" -- these all used to be handled
    // inconsistently across the five call sites.
    expect(pgSslConfig({ DATABASE_SSL: 'true' })).not.toBe(false);
    expect(pgSslConfig({ DATABASE_SSL: 'FALSE' })).not.toBe(false);
    expect(pgSslConfig({ DATABASE_SSL: '0' })).not.toBe(false);
    expect(pgSslConfig({ DATABASE_SSL: '' })).not.toBe(false);
  });

  it('honours the explicit opt-out for untrusted certificates in production', () => {
    expect(
      pgSslConfig({ NODE_ENV: 'production', DATABASE_SSL_REJECT_UNAUTHORIZED: 'false' }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('ignores the opt-out unless it is exactly "false"', () => {
    expect(
      pgSslConfig({ NODE_ENV: 'production', DATABASE_SSL_REJECT_UNAUTHORIZED: 'no' }),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('lets DATABASE_SSL=false win over the verification flag', () => {
    expect(
      pgSslConfig({
        NODE_ENV: 'production',
        DATABASE_SSL: 'false',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
      }),
    ).toBe(false);
  });
});
