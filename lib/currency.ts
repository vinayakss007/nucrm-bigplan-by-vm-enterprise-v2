/**
 * Multi-Currency Engine
 *
 * Provides currency conversion, exchange rate fetching, formatting,
 * and supported currencies list. Rates are cached in-memory with 1h TTL.
 */

export interface ExchangeRateCache {
  rates: Record<string, number>;
  baseCurrency: string;
  fetchedAt: number;
}

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
}

// In-memory cache with 1h TTL
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let rateCache: ExchangeRateCache | null = null;

/**
 * Supported currencies (30+ major currencies)
 */
export const SUPPORTED_CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC', decimalPlaces: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3', decimalPlaces: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9', decimalPlaces: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalPlaces: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimalPlaces: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5', decimalPlaces: 0 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '\u00A5', decimalPlaces: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimalPlaces: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', decimalPlaces: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimalPlaces: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', decimalPlaces: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimalPlaces: 2 },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimalPlaces: 2 },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr', decimalPlaces: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimalPlaces: 2 },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', decimalPlaces: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimalPlaces: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', decimalPlaces: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', decimalPlaces: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '\u20A9', decimalPlaces: 0 },
  { code: 'THB', name: 'Thai Baht', symbol: '\u0E3F', decimalPlaces: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', decimalPlaces: 2 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', decimalPlaces: 0 },
  { code: 'PHP', name: 'Philippine Peso', symbol: '\u20B1', decimalPlaces: 2 },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'z\u0142', decimalPlaces: 2 },
  { code: 'TRY', name: 'Turkish Lira', symbol: '\u20BA', decimalPlaces: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '\u20BD', decimalPlaces: 2 },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'K\u010D', decimalPlaces: 2 },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', decimalPlaces: 0 },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '\u20AA', decimalPlaces: 2 },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$', decimalPlaces: 0 },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$', decimalPlaces: 2 },
];

/**
 * Get supported currencies list
 */
export function getSupportedCurrencies(): CurrencyInfo[] {
  return SUPPORTED_CURRENCIES;
}

/**
 * Fetch latest exchange rates from external API
 */
export async function fetchLatestRates(baseCurrency: string = 'USD'): Promise<Record<string, number>> {
  const apiKey = process.env['EXCHANGE_RATE_API_KEY'] || 'demo';
  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${baseCurrency}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Exchange rate API returned ${response.status}`);
    }
    const data = await response.json();
    if (data.result !== 'success') {
      throw new Error(`Exchange rate API error: ${data['error-type'] || 'unknown'}`);
    }

    const rates: Record<string, number> = data.conversion_rates || {};

    // Update cache
    rateCache = {
      rates,
      baseCurrency,
      fetchedAt: Date.now(),
    };

    return rates;
  } catch (error) {
    // If fetch fails, return cached rates if available
    if (rateCache && rateCache.baseCurrency === baseCurrency) {
      return rateCache.rates;
    }
    throw error;
  }
}

/**
 * Get exchange rate between two currencies.
 * Uses in-memory cache with 1h TTL.
 */
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;

  // Check cache freshness
  const now = Date.now();
  if (!rateCache || (now - rateCache.fetchedAt) > CACHE_TTL_MS) {
    await fetchLatestRates('USD');
  }

  if (!rateCache) {
    throw new Error('Unable to fetch exchange rates');
  }

  const fromRate = rateCache.rates[from];
  const toRate = rateCache.rates[to];

  if (!fromRate || !toRate) {
    throw new Error(`Unsupported currency pair: ${from}/${to}`);
  }

  // Cross-rate calculation: to_rate / from_rate
  return toRate / fromRate;
}

/**
 * Convert amount from one currency to another
 */
export async function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  _date?: string
): Promise<{ convertedAmount: number; rate: number }> {
  if (fromCurrency === toCurrency) {
    return { convertedAmount: amount, rate: 1 };
  }

  const rate = await getExchangeRate(fromCurrency, toCurrency);
  const convertedAmount = Math.round(amount * rate * 100) / 100;

  return { convertedAmount, rate };
}

/**
 * Format currency amount with locale-aware formatting
 */
export function formatCurrency(
  amount: number,
  currencyCode: string,
  locale: string = 'en-US'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount);
  } catch {
    // Fallback to default on corrupted storage data
    const info = SUPPORTED_CURRENCIES.find(c => c.code === currencyCode);
    const symbol = info?.symbol || currencyCode;
    return `${symbol}${amount.toFixed(info?.decimalPlaces ?? 2)}`;
  }
}

/**
 * Clear the rate cache (useful for testing)
 */
export function clearRateCache(): void {
  rateCache = null;
}

/**
 * Set rate cache directly (useful for testing and seeding)
 */
export function setRateCache(cache: ExchangeRateCache): void {
  rateCache = cache;
}
