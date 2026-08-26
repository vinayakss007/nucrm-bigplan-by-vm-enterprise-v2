import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Currency Module - Extended', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe('fetchLatestRates', () => {
    it('fetches rates successfully and caches them', async () => {
      const mockRates = { USD: 1, EUR: 0.85, GBP: 0.73 };
      const mockResponse = {
        ok: true,
        json: async () => ({ result: 'success', conversion_rates: mockRates }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      const rates = await fetchLatestRates('USD');

      expect(rates).toEqual(mockRates);
      expect(fetch).toHaveBeenCalledWith(
        'https://v6.exchangerate-api.com/v6/demo/latest/USD',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('uses EXCHANGE_RATE_API_KEY from env when set', async () => {
      process.env.EXCHANGE_RATE_API_KEY = 'custom-key-456';
      const mockResponse = {
        ok: true,
        json: async () => ({ result: 'success', conversion_rates: { USD: 1 } }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      await fetchLatestRates('EUR');

      expect(fetch).toHaveBeenCalledWith(
        'https://v6.exchangerate-api.com/v6/custom-key-456/latest/EUR',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('throws when response status is not ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 429 })
      );

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      await expect(fetchLatestRates('USD')).rejects.toThrow(
        'Exchange rate API returned 429'
      );
    });

    it('throws when API result is not success', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: 'error',
            'error-type': 'unsupported-code',
          }),
        })
      );

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      await expect(fetchLatestRates('USD')).rejects.toThrow(
        'Exchange rate API error: unsupported-code'
      );
    });

    it('throws with unknown error-type when none provided', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ result: 'error' }),
        })
      );

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      await expect(fetchLatestRates('USD')).rejects.toThrow(
        'Exchange rate API error: unknown'
      );
    });

    it('returns cached rates when fetch fails and cache exists with same baseCurrency', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { fetchLatestRates, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.85 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      const rates = await fetchLatestRates('USD');
      expect(rates).toEqual({ USD: 1, EUR: 0.85 });
    });

    it('re-throws error when fetch fails and no cache exists', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { fetchLatestRates, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      await expect(fetchLatestRates('USD')).rejects.toThrow('Network failure');
    });

    it('re-throws error when fetch fails and cache has different baseCurrency', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { fetchLatestRates, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { EUR: 1, USD: 1.18 },
        baseCurrency: 'EUR',
        fetchedAt: Date.now(),
      });

      await expect(fetchLatestRates('USD')).rejects.toThrow('Network failure');
    });
  });

  describe('getExchangeRate - cache miss / error paths', () => {
    it('fetches fresh rates when cache is null', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: 'success',
            conversion_rates: { USD: 1, EUR: 0.85 },
          }),
        })
      );

      const { getExchangeRate, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      const rate = await getExchangeRate('USD', 'EUR');
      expect(rate).toBe(0.85);
      expect(fetch).toHaveBeenCalled();
    });

    it('fetches fresh rates when cache is expired (older than 1h)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: 'success',
            conversion_rates: { USD: 1, EUR: 0.90 },
          }),
        })
      );

      const { getExchangeRate, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.85 },
        baseCurrency: 'USD',
        fetchedAt: Date.now() - 61 * 60 * 1000,
      });

      const rate = await getExchangeRate('USD', 'EUR');
      expect(rate).toBe(0.90);
    });

    it('throws for unsupported currency pair', async () => {
      const { getExchangeRate, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.85 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      await expect(getExchangeRate('USD', 'XYZ')).rejects.toThrow(
        'Unsupported currency pair: USD/XYZ'
      );
      await expect(getExchangeRate('XYZ', 'USD')).rejects.toThrow(
        'Unsupported currency pair: XYZ/USD'
      );
    });

    it('throws when missing fromRate in cache', async () => {
      const { getExchangeRate, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      await expect(getExchangeRate('USD', 'EUR')).rejects.toThrow(
        'Unsupported currency pair: USD/EUR'
      );
    });

    it('propagates fetch error when neither cache nor network available', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { getExchangeRate, clearRateCache } = await import('@/lib/currency');
      clearRateCache();

      await expect(getExchangeRate('USD', 'EUR')).rejects.toThrow('Network failure');
    });
  });

  describe('formatCurrency - fallback error path', () => {
    it('falls back to symbol format when Intl.NumberFormat throws', async () => {
      const spy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => {
          throw new RangeError('Invalid locale');
        });

      const { formatCurrency } = await import('@/lib/currency');
      const result = formatCurrency(1234.56, 'USD');

      expect(result).toBe('$1234.56');
      spy.mockRestore();
    });

    it('uses currency code as fallback symbol for unknown currency', async () => {
      const spy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => {
          throw new RangeError('Invalid locale');
        });

      const { formatCurrency } = await import('@/lib/currency');
      const result = formatCurrency(500, 'XXX');

      expect(result).toBe('XXX500.00');
      spy.mockRestore();
    });

    it('handles JPY with 0 decimal places in fallback', async () => {
      const spy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => {
          throw new RangeError('Invalid locale');
        });

      const { formatCurrency } = await import('@/lib/currency');
      const result = formatCurrency(1000, 'JPY');

      expect(result).toBe('\u00A51000');
      spy.mockRestore();
    });

    it('handles negative amounts in fallback', async () => {
      const spy = vi
        .spyOn(Intl, 'NumberFormat')
        .mockImplementation(() => {
          throw new RangeError('Invalid locale');
        });

      const { formatCurrency } = await import('@/lib/currency');
      const result = formatCurrency(-50.5, 'USD');

      expect(result).toBe('$-50.50');
      spy.mockRestore();
    });
  });

  describe('clearRateCache / setRateCache', () => {
    it('clearRateCache resets internal cache so next fetch attempts to call API', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network')));

      const { clearRateCache, setRateCache, getExchangeRate } = await import('@/lib/currency');
      setRateCache({
        rates: { USD: 1 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });
      clearRateCache();

      await expect(getExchangeRate('USD', 'EUR')).rejects.toThrow('No network');
    });

    it('setRateCache overwrites any existing cache', async () => {
      const { setRateCache, getExchangeRate, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { ABC: 1, DEF: 2 },
        baseCurrency: 'ABC',
        fetchedAt: Date.now(),
      });

      const rate = await getExchangeRate('ABC', 'DEF');
      expect(rate).toBe(2);
    });

    it('setRateCache with stale timestamp forces re-fetch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: 'success',
            conversion_rates: { USD: 1, EUR: 0.88 },
          }),
        })
      );

      const { setRateCache, getExchangeRate, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.85 },
        baseCurrency: 'USD',
        fetchedAt: Date.now() - 61 * 60 * 1000,
      });

      const rate = await getExchangeRate('USD', 'EUR');
      expect(rate).toBe(0.88);
    });
  });

  describe('convertAmount - edge cases', () => {
    it('handles zero amount conversion', async () => {
      const { convertAmount, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.85 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      const result = await convertAmount(0, 'USD', 'EUR');
      expect(result.convertedAmount).toBe(0);
      expect(result.rate).toBe(0.85);
    });

    it('handles very large amounts', async () => {
      const { convertAmount, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, JPY: 149.5 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      const result = await convertAmount(1_000_000_000, 'USD', 'JPY');
      expect(result.convertedAmount).toBe(149_500_000_000);
      expect(result.rate).toBe(149.5);
    });

    it('handles very small fractional amounts', async () => {
      const { convertAmount, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, INR: 83.12 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      const result = await convertAmount(0.01, 'USD', 'INR');
      expect(result.convertedAmount).toBe(0.83);
      expect(result.rate).toBe(83.12);
    });

    it('rounds converted amount to 2 decimal places', async () => {
      const { convertAmount, setRateCache, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: { USD: 1, EUR: 0.8555 },
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      const result = await convertAmount(99.99, 'USD', 'EUR');
      expect(result.convertedAmount).toBe(85.54);
      expect(result.rate).toBe(0.8555);
    });
  });

  describe('getSupportedCurrencies - data integrity', () => {
    it('all currency codes are uppercase', async () => {
      const { getSupportedCurrencies } = await import('@/lib/currency');
      const currencies = getSupportedCurrencies();
      for (const c of currencies) {
        expect(c.code).toBe(c.code.toUpperCase());
      }
    });

    it('no duplicate currency codes', async () => {
      const { getSupportedCurrencies } = await import('@/lib/currency');
      const currencies = getSupportedCurrencies();
      const codes = currencies.map(c => c.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('decimalPlaces is always 0 or 2', async () => {
      const { getSupportedCurrencies } = await import('@/lib/currency');
      const currencies = getSupportedCurrencies();
      for (const c of currencies) {
        expect([0, 2]).toContain(c.decimalPlaces);
      }
    });
  });

  describe('ExchangeRateCache type contract', () => {
    it('setRateCache rejects cache with missing fields at runtime', async () => {
      const { setRateCache } = await import('@/lib/currency');

      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setRateCache({} as any)
      ).not.toThrow();

      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setRateCache({ rates: {}, baseCurrency: 'USD' } as any)
      ).not.toThrow();
    });

    it('setRateCache with empty rates object', async () => {
      const { setRateCache, getExchangeRate, clearRateCache } = await import('@/lib/currency');
      clearRateCache();
      setRateCache({
        rates: {},
        baseCurrency: 'USD',
        fetchedAt: Date.now(),
      });

      await expect(getExchangeRate('USD', 'EUR')).rejects.toThrow(
        'Unsupported currency pair: USD/EUR'
      );
    });
  });
});
