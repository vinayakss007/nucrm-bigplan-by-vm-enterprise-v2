import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSupportedCurrencies,
  formatCurrency,
  convertAmount,
  getExchangeRate,
  setRateCache,
  clearRateCache,
} from '@/lib/currency';

describe('Currency - getSupportedCurrencies', () => {
  it('returns 30+ supported currencies', () => {
    const currencies = getSupportedCurrencies();
    expect(currencies.length).toBeGreaterThanOrEqual(30);
  });

  it('includes major currencies (USD, EUR, GBP, INR)', () => {
    const currencies = getSupportedCurrencies();
    const codes = currencies.map(c => c.code);
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes).toContain('INR');
  });

  it('each currency has required fields', () => {
    const currencies = getSupportedCurrencies();
    for (const c of currencies) {
      expect(c.code).toBeDefined();
      expect(c.name).toBeDefined();
      expect(c.symbol).toBeDefined();
      expect(typeof c.decimalPlaces).toBe('number');
    }
  });
});

describe('Currency - formatCurrency', () => {
  it('formats USD correctly', () => {
    const result = formatCurrency(1234.56, 'USD', 'en-US');
    expect(result).toContain('1,234.56');
    expect(result).toContain('$');
  });

  it('formats EUR with locale', () => {
    const result = formatCurrency(999.99, 'EUR', 'de-DE');
    expect(result).toContain('999,99');
  });

  it('formats JPY without decimal places', () => {
    const result = formatCurrency(1000, 'JPY', 'ja-JP');
    // JPY has 0 decimal places
    expect(result).toContain('1,000');
  });

  it('handles zero amount', () => {
    const result = formatCurrency(0, 'USD', 'en-US');
    expect(result).toContain('0');
  });
});

describe('Currency - Exchange Rate and Conversion', () => {
  beforeEach(() => {
    clearRateCache();
    // Seed cache with known rates for testing
    setRateCache({
      rates: {
        USD: 1,
        EUR: 0.85,
        GBP: 0.73,
        INR: 83.12,
        JPY: 149.5,
        CAD: 1.36,
        AUD: 1.53,
      },
      baseCurrency: 'USD',
      fetchedAt: Date.now(),
    });
  });

  it('returns rate of 1 for same currency', async () => {
    const rate = await getExchangeRate('USD', 'USD');
    expect(rate).toBe(1);
  });

  it('returns correct exchange rate from cache', async () => {
    const rate = await getExchangeRate('USD', 'EUR');
    expect(rate).toBe(0.85);
  });

  it('calculates cross-rate between non-USD currencies', async () => {
    const rate = await getExchangeRate('EUR', 'GBP');
    // GBP/EUR = 0.73 / 0.85 ~= 0.8588
    expect(rate).toBeCloseTo(0.73 / 0.85, 4);
  });

  it('converts amount correctly', async () => {
    const result = await convertAmount(100, 'USD', 'EUR');
    expect(result.convertedAmount).toBe(85);
    expect(result.rate).toBe(0.85);
  });

  it('returns same amount when converting to same currency', async () => {
    const result = await convertAmount(250.50, 'USD', 'USD');
    expect(result.convertedAmount).toBe(250.50);
    expect(result.rate).toBe(1);
  });

  it('converts between non-USD currencies correctly', async () => {
    const result = await convertAmount(1000, 'EUR', 'INR');
    // Rate = INR/EUR = 83.12 / 0.85 ~= 97.788
    const expectedRate = 83.12 / 0.85;
    const expected = Math.round(1000 * expectedRate * 100) / 100;
    expect(result.convertedAmount).toBe(expected);
  });
});
