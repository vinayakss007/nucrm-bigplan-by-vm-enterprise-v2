import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { convertAmount, setRateCache, clearRateCache, SUPPORTED_CURRENCIES } from '@/lib/currency';

describe('Currency Conversion', () => {
  beforeEach(() => {
    setRateCache({
      rates: {
        USD: 1,
        JPY: 150,
        KRW: 1300,
        EUR: 0.92,
        GBP: 0.79,
        HUF: 360,
        CLP: 900,
        IDR: 15000,
      },
      baseCurrency: 'USD',
      fetchedAt: Date.now(),
    });
  });

  afterEach(() => {
    clearRateCache();
  });

  it('converting 100 USD to JPY gives a whole number (no decimals)', async () => {
    const result = await convertAmount(100, 'USD', 'JPY');
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount));
    expect(result.convertedAmount % 1).toBe(0);
  });

  it('converting 100 USD to KRW gives a whole number', async () => {
    const result = await convertAmount(100, 'USD', 'KRW');
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount));
    expect(result.convertedAmount % 1).toBe(0);
  });

  it('converting 100 USD to EUR gives at most 2 decimal places', async () => {
    const result = await convertAmount(100, 'USD', 'EUR');
    const decimalPart = result.convertedAmount.toString().split('.')[1];
    if (decimalPart) {
      expect(decimalPart.length).toBeLessThanOrEqual(2);
    }
  });

  it('converting 100 USD to HUF gives a whole number', async () => {
    const result = await convertAmount(100, 'USD', 'HUF');
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount));
    expect(result.convertedAmount % 1).toBe(0);
  });

  it('converting 100 USD to CLP gives a whole number', async () => {
    const result = await convertAmount(100, 'USD', 'CLP');
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount));
    expect(result.convertedAmount % 1).toBe(0);
  });

  it('converting 100 USD to IDR gives a whole number', async () => {
    const result = await convertAmount(100, 'USD', 'IDR');
    expect(result.convertedAmount).toBe(Math.round(result.convertedAmount));
    expect(result.convertedAmount % 1).toBe(0);
  });

  it('same currency returns exact amount with rate 1', async () => {
    const result = await convertAmount(123.45, 'USD', 'USD');
    expect(result.convertedAmount).toBe(123.45);
    expect(result.rate).toBe(1);
  });

  it('SUPPORTED_CURRENCIES includes zero-decimal currencies', () => {
    const zeroDecimal = SUPPORTED_CURRENCIES.filter(c => c.decimalPlaces === 0);
    const codes = zeroDecimal.map(c => c.code);
    expect(codes).toContain('JPY');
    expect(codes).toContain('KRW');
    expect(codes).toContain('HUF');
    expect(codes).toContain('CLP');
    expect(codes).toContain('IDR');
  });
});
