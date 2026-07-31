import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SsrfBlockedError,
  isPrivateIpv4,
  isPrivateIpv6,
  isBlockedHostname,
  assertSafeUrl,
  getEnvAllowedHosts,
  safeFetch,
} from '@/lib/security/ssrf';

describe('security/ssrf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['SSRF_ALLOWED_HOSTS'];
  });

  describe('isPrivateIpv4', () => {
    it('blocks the RFC1918 10.0.0.0/8 range', () => {
      expect(isPrivateIpv4('10.0.0.1')).toBe(true);
      expect(isPrivateIpv4('10.255.255.254')).toBe(true);
    });

    it('blocks the RFC1918 172.16.0.0/12 range', () => {
      expect(isPrivateIpv4('172.16.0.1')).toBe(true);
      expect(isPrivateIpv4('172.31.255.254')).toBe(true);
      // 172.32.x is outside the /12 and therefore public
      expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    });

    it('blocks the RFC1918 192.168.0.0/16 range', () => {
      expect(isPrivateIpv4('192.168.1.1')).toBe(true);
    });

    it('blocks loopback 127.0.0.0/8', () => {
      expect(isPrivateIpv4('127.0.0.1')).toBe(true);
      expect(isPrivateIpv4('127.1.2.3')).toBe(true);
    });

    it('blocks link-local 169.254.0.0/16 (cloud metadata)', () => {
      expect(isPrivateIpv4('169.254.169.254')).toBe(true);
      expect(isPrivateIpv4('169.254.0.1')).toBe(true);
    });

    it('blocks the 0.0.0.0/8 range', () => {
      expect(isPrivateIpv4('0.0.0.0')).toBe(true);
      expect(isPrivateIpv4('0.1.2.3')).toBe(true);
    });

    it('blocks CGNAT 100.64.0.0/10', () => {
      expect(isPrivateIpv4('100.64.0.1')).toBe(true);
      expect(isPrivateIpv4('100.127.255.254')).toBe(true);
    });

    it('blocks IETF/test/benchmark ranges', () => {
      expect(isPrivateIpv4('192.0.0.1')).toBe(true);      // 192.0.0.0/24
      expect(isPrivateIpv4('192.0.2.5')).toBe(true);       // 192.0.2.0/24
      expect(isPrivateIpv4('198.18.0.1')).toBe(true);      // 198.18.0.0/15
      expect(isPrivateIpv4('198.19.255.1')).toBe(true);    // 198.18.0.0/15
      expect(isPrivateIpv4('198.51.100.7')).toBe(true);    // 198.51.100.0/24
      expect(isPrivateIpv4('203.0.113.7')).toBe(true);     // 203.0.113.0/24
    });

    it('blocks multicast, reserved and broadcast addresses', () => {
      expect(isPrivateIpv4('224.0.0.1')).toBe(true);       // 224.0.0.0/4
      expect(isPrivateIpv4('239.1.2.3')).toBe(true);       // 224.0.0.0/4
      expect(isPrivateIpv4('240.0.0.1')).toBe(true);       // 240.0.0.0/4
      expect(isPrivateIpv4('255.255.255.255')).toBe(true); // broadcast
    });

    it('allows public IPv4 addresses', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false);
      expect(isPrivateIpv4('1.1.1.1')).toBe(false);
      expect(isPrivateIpv4('93.184.216.34')).toBe(false);
    });

    it('returns false for input that is not an IPv4 literal', () => {
      expect(isPrivateIpv4('example.com')).toBe(false);
      expect(isPrivateIpv4('10.0.0')).toBe(false);
      expect(isPrivateIpv4('999.1.1.1')).toBe(false);
      expect(isPrivateIpv4('')).toBe(false);
    });
  });

  describe('isPrivateIpv6', () => {
    it('blocks loopback ::1 and unspecified ::', () => {
      expect(isPrivateIpv6('::1')).toBe(true);
      expect(isPrivateIpv6('::')).toBe(true);
    });

    it('blocks unique local fc00::/7', () => {
      expect(isPrivateIpv6('fc00::1')).toBe(true);
      expect(isPrivateIpv6('fd12:3456::1')).toBe(true);
    });

    it('blocks link local fe80::/10', () => {
      expect(isPrivateIpv6('fe80::1')).toBe(true);
      expect(isPrivateIpv6('fe80::1%eth0')).toBe(true);
    });

    it('blocks multicast ff00::/8', () => {
      expect(isPrivateIpv6('ff02::1')).toBe(true);
    });

    it('blocks IPv4-mapped addresses wrapping a private IPv4', () => {
      expect(isPrivateIpv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpv6('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateIpv6('[::ffff:10.0.0.1]')).toBe(true);
    });

    it('allows public IPv6 addresses', () => {
      expect(isPrivateIpv6('2606:4700::1111')).toBe(false);
      expect(isPrivateIpv6('2001:4860:4860::8888')).toBe(false);
      expect(isPrivateIpv6('::ffff:8.8.8.8')).toBe(false);
    });

    it('returns false for input that is not an IPv6 literal', () => {
      expect(isPrivateIpv6('127.0.0.1')).toBe(false);
      expect(isPrivateIpv6('example.com')).toBe(false);
      expect(isPrivateIpv6('gg::1')).toBe(false);
    });
  });

  describe('isBlockedHostname', () => {
    it('blocks localhost and its subdomains', () => {
      expect(isBlockedHostname('localhost')).toBe(true);
      expect(isBlockedHostname('foo.localhost')).toBe(true);
      expect(isBlockedHostname('LOCALHOST')).toBe(true);
    });

    it('blocks mDNS .local and .internal names', () => {
      expect(isBlockedHostname('printer.local')).toBe(true);
      expect(isBlockedHostname('db.internal')).toBe(true);
    });

    it('blocks cloud metadata hostnames', () => {
      expect(isBlockedHostname('metadata.google.internal')).toBe(true);
      expect(isBlockedHostname('metadata.goog')).toBe(true);
      expect(isBlockedHostname('metadata')).toBe(true);
    });

    it('allows normal public hostnames', () => {
      expect(isBlockedHostname('example.com')).toBe(false);
      expect(isBlockedHostname('api.stripe.com')).toBe(false);
      expect(isBlockedHostname('localhost.example.com')).toBe(false);
    });
  });

  describe('assertSafeUrl', () => {
    it('blocks the cloud metadata endpoint', () => {
      expect(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/')).toThrow(SsrfBlockedError);
    });

    it('blocks localhost with a port', () => {
      expect(() => assertSafeUrl('http://localhost:3000')).toThrow(SsrfBlockedError);
    });

    it('blocks loopback and RFC1918 literals', () => {
      expect(() => assertSafeUrl('http://127.0.0.1')).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('http://10.1.2.3')).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('http://192.168.1.1')).toThrow(SsrfBlockedError);
    });

    it('blocks bracketed IPv6 loopback', () => {
      expect(() => assertSafeUrl('http://[::1]:8080')).toThrow(SsrfBlockedError);
    });

    it('blocks non-HTTP(S) protocols', () => {
      expect(() => assertSafeUrl('file:///etc/passwd')).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('gopher://x')).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('ftp://example.com/f')).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('data:text/plain,hi')).toThrow(SsrfBlockedError);
    });

    it('blocks URLs with embedded credentials', () => {
      expect(() => assertSafeUrl('http://user:pass@example.com')).toThrow(SsrfBlockedError);
    });

    it('blocks unparseable URLs', () => {
      expect(() => assertSafeUrl('not a url')).toThrow(SsrfBlockedError);
    });

    it('exposes a reason on the thrown error', () => {
      try {
        assertSafeUrl('http://169.254.169.254/');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError);
        expect((err as SsrfBlockedError).reason).toBeTypeOf('string');
        expect((err as SsrfBlockedError).reason.length).toBeGreaterThan(0);
      }
    });

    it('returns a URL for public https targets', () => {
      const stripe = assertSafeUrl('https://api.stripe.com/v1/charges');
      expect(stripe).toBeInstanceOf(URL);
      expect(stripe.hostname).toBe('api.stripe.com');
      expect(stripe.pathname).toBe('/v1/charges');

      const example = assertSafeUrl('https://example.com');
      expect(example).toBeInstanceOf(URL);
      expect(example.hostname).toBe('example.com');
    });

    it('honours an explicit allowlist for otherwise-blocked hosts', () => {
      expect(() => assertSafeUrl('http://10.1.2.3:9000/health')).toThrow(SsrfBlockedError);
      const allowed = assertSafeUrl('http://10.1.2.3:9000/health', { allowedHosts: ['10.1.2.3'] });
      expect(allowed.hostname).toBe('10.1.2.3');

      const named = assertSafeUrl('http://internal-api.internal/v1', { allowedHosts: ['INTERNAL-API.INTERNAL'] });
      expect(named.hostname).toBe('internal-api.internal');
    });

    it('still refuses bad protocols and credentials for allowlisted hosts', () => {
      expect(() => assertSafeUrl('file://10.1.2.3/etc/passwd', { allowedHosts: ['10.1.2.3'] })).toThrow(SsrfBlockedError);
      expect(() => assertSafeUrl('http://u:p@10.1.2.3/', { allowedHosts: ['10.1.2.3'] })).toThrow(SsrfBlockedError);
    });
  });

  describe('getEnvAllowedHosts', () => {
    it('returns an empty list when the env var is unset', () => {
      delete process.env['SSRF_ALLOWED_HOSTS'];
      expect(getEnvAllowedHosts()).toEqual([]);
    });

    it('parses a comma-separated list, trims entries and ignores empties', () => {
      process.env['SSRF_ALLOWED_HOSTS'] = ' internal.svc , 10.0.0.5 ,, ';
      expect(getEnvAllowedHosts()).toEqual(['internal.svc', '10.0.0.5']);
    });
  });

  describe('safeFetch', () => {
    it('rejects a blocked URL without ever calling fetch', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(SsrfBlockedError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('passes a public URL through to fetch with manual redirect handling', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() });
      vi.stubGlobal('fetch', mockFetch);

      const res = await safeFetch('https://example.com/hook', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]![0]).toBe('https://example.com/hook');
      expect(mockFetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'manual' });
    });

    it('re-validates a redirect location and blocks a hop to the metadata service', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        ok: false,
        headers: new Headers({ location: 'http://169.254.169.254/' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(safeFetch('https://example.com/redirect')).rejects.toThrow(SsrfBlockedError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('follows a safe redirect and returns the final response', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ status: 302, ok: false, headers: new Headers({ location: 'https://example.org/final' }) })
        .mockResolvedValueOnce({ status: 200, ok: true, headers: new Headers() });
      vi.stubGlobal('fetch', mockFetch);

      const res = await safeFetch('https://example.com/start');
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]![0]).toBe('https://example.org/final');
    });

    it('throws once the redirect hop limit is exceeded', async () => {
      let n = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        n += 1;
        return Promise.resolve({
          status: 302,
          ok: false,
          headers: new Headers({ location: `https://example.com/hop-${n}` }),
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(safeFetch('https://example.com/start')).rejects.toThrow(SsrfBlockedError);
      expect(mockFetch).toHaveBeenCalledTimes(4); // initial request + 3 hops
    });

    it('preserves a caller-supplied abort signal instead of clobbering it', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() });
      vi.stubGlobal('fetch', mockFetch);

      const controller = new AbortController();
      await safeFetch('https://example.com', { signal: controller.signal });
      expect(mockFetch.mock.calls[0]![1].signal).toBe(controller.signal);
    });

    it('applies a default timeout signal when the caller supplies none', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() });
      vi.stubGlobal('fetch', mockFetch);

      await safeFetch('https://example.com');
      expect(mockFetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    });

    it('merges SSRF_ALLOWED_HOSTS from the environment into the allowlist', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() });
      vi.stubGlobal('fetch', mockFetch);

      process.env['SSRF_ALLOWED_HOSTS'] = '10.9.9.9';
      const res = await safeFetch('http://10.9.9.9:8080/ping');
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('still blocks hosts absent from SSRF_ALLOWED_HOSTS', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      process.env['SSRF_ALLOWED_HOSTS'] = '10.9.9.9';
      await expect(safeFetch('http://127.0.0.1:5432/')).rejects.toThrow(SsrfBlockedError);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
