/**
 * PayU Integration Tests
 *
 * Tests PayU utility functions: configuration checks, hash generation,
 * hash verification, payment link creation, and URL resolution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

const MOCK_KEY = 'test_merchant_key';
const MOCK_SALT = 'test_merchant_salt';

function setPayUEnv(overrides: Record<string, string | undefined> = {}) {
  process.env['PAYU_MERCHANT_KEY'] = overrides['PAYU_MERCHANT_KEY'] ?? MOCK_KEY;
  process.env['PAYU_MERCHANT_SALT'] = overrides['PAYU_MERCHANT_SALT'] ?? MOCK_SALT;
  process.env['PAYU_MODE'] = overrides['PAYU_MODE'] ?? 'test';
}

function clearPayUEnv() {
  delete process.env['PAYU_MERCHANT_KEY'];
  delete process.env['PAYU_MERCHANT_SALT'];
  delete process.env['PAYU_MODE'];
}

describe('lib/payu', () => {
  beforeEach(() => {
    setPayUEnv();
    vi.resetModules();
  });

  afterEach(() => {
    clearPayUEnv();
  });

  describe('isPayUConfigured', () => {
    it('returns true when both PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT are set', async () => {
      const { isPayUConfigured } = await import('@/lib/payu');
      expect(isPayUConfigured()).toBe(true);
    });

    it('returns false when PAYU_MERCHANT_KEY is missing', async () => {
      delete process.env['PAYU_MERCHANT_KEY'];
      const { isPayUConfigured } = await import('@/lib/payu');
      expect(isPayUConfigured()).toBe(false);
    });

    it('returns false when PAYU_MERCHANT_SALT is missing', async () => {
      delete process.env['PAYU_MERCHANT_SALT'];
      const { isPayUConfigured } = await import('@/lib/payu');
      expect(isPayUConfigured()).toBe(false);
    });

    it('returns false when both keys are missing', async () => {
      clearPayUEnv();
      const { isPayUConfigured } = await import('@/lib/payu');
      expect(isPayUConfigured()).toBe(false);
    });
  });

  describe('getPayUBaseUrl', () => {
    it('returns test URL when PAYU_MODE is test', async () => {
      process.env['PAYU_MODE'] = 'test';
      const { getPayUBaseUrl } = await import('@/lib/payu');
      expect(getPayUBaseUrl()).toBe('https://test.payu.in/_payment');
    });

    it('returns production URL when PAYU_MODE is production', async () => {
      process.env['PAYU_MODE'] = 'production';
      const { getPayUBaseUrl } = await import('@/lib/payu');
      expect(getPayUBaseUrl()).toBe('https://secure.payu.in/_payment');
    });

    it('defaults to test URL when PAYU_MODE is not set', async () => {
      delete process.env['PAYU_MODE'];
      const { getPayUBaseUrl } = await import('@/lib/payu');
      expect(getPayUBaseUrl()).toBe('https://test.payu.in/_payment');
    });
  });

  describe('generatePayUHash', () => {
    it('generates correct SHA-512 hash with basic params', async () => {
      const { generatePayUHash } = await import('@/lib/payu');

      const params = {
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
      };

      const hash = generatePayUHash(params);

      // Verify manually computed hash
      const hashString = `${MOCK_KEY}|txn123|100.00|Test Product|John|john@example.com|||||||||||${MOCK_SALT}`;
      const expected = crypto.createHash('sha512').update(hashString).digest('hex');
      expect(hash).toBe(expected);
    });

    it('includes udf fields in hash when provided', async () => {
      const { generatePayUHash } = await import('@/lib/payu');

      const params = {
        key: MOCK_KEY,
        txnid: 'txn456',
        amount: '250.50',
        productinfo: 'Premium Plan',
        firstname: 'Jane',
        email: 'jane@example.com',
        udf1: 'field1',
        udf2: 'field2',
        udf3: 'field3',
        udf4: 'field4',
        udf5: 'field5',
      };

      const hash = generatePayUHash(params);

      const hashString = `${MOCK_KEY}|txn456|250.50|Premium Plan|Jane|jane@example.com|field1|field2|field3|field4|field5||||||${MOCK_SALT}`;
      const expected = crypto.createHash('sha512').update(hashString).digest('hex');
      expect(hash).toBe(expected);
    });

    it('throws error when PAYU_MERCHANT_SALT is not set', async () => {
      delete process.env['PAYU_MERCHANT_SALT'];
      const { generatePayUHash } = await import('@/lib/payu');

      expect(() => generatePayUHash({
        key: MOCK_KEY,
        txnid: 'txn789',
        amount: '50.00',
        productinfo: 'Item',
        firstname: 'Bob',
        email: 'bob@example.com',
      })).toThrow('PAYU_MERCHANT_SALT is not configured');
    });

    it('produces a 128-character hex string', async () => {
      const { generatePayUHash } = await import('@/lib/payu');

      const hash = generatePayUHash({
        key: MOCK_KEY,
        txnid: 'txn_test',
        amount: '10.00',
        productinfo: 'Test',
        firstname: 'User',
        email: 'user@test.com',
      });

      expect(hash).toHaveLength(128);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('verifyPayUResponse', () => {
    it('returns true for valid response hash', async () => {
      const { verifyPayUResponse } = await import('@/lib/payu');

      // Compute the reverse hash manually
      // Reverse formula: salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
      const reverseString = `${MOCK_SALT}|success|||||||||||john@example.com|John|Test Product|100.00|txn123|${MOCK_KEY}`;
      const validHash = crypto.createHash('sha512').update(reverseString).digest('hex');

      const result = verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: validHash,
      });

      expect(result).toBe(true);
    });

    it('returns false for tampered hash', async () => {
      const { verifyPayUResponse } = await import('@/lib/payu');

      const result = verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: 'invalid_hash_value',
      });

      expect(result).toBe(false);
    });

    it('returns false when amount is tampered', async () => {
      const { verifyPayUResponse } = await import('@/lib/payu');

      // Generate hash for 100.00 but claim 200.00
      const reverseString = `${MOCK_SALT}|success||||||||||john@example.com|John|Test Product|100.00|txn123|${MOCK_KEY}`;
      const validHash = crypto.createHash('sha512').update(reverseString).digest('hex');

      const result = verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '200.00', // Tampered amount
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: validHash,
      });

      expect(result).toBe(false);
    });

    it('handles additionalCharges in verification', async () => {
      const { verifyPayUResponse } = await import('@/lib/payu');

      const reverseString = `5.00|${MOCK_SALT}|success|||||||||||john@example.com|John|Test Product|100.00|txn123|${MOCK_KEY}`;
      const validHash = crypto.createHash('sha512').update(reverseString).digest('hex');

      const result = verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: validHash,
        additionalCharges: '5.00',
      });

      expect(result).toBe(true);
    });

    it('throws error when PAYU_MERCHANT_SALT is not set', async () => {
      delete process.env['PAYU_MERCHANT_SALT'];
      const { verifyPayUResponse } = await import('@/lib/payu');

      expect(() => verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: 'anything',
      })).toThrow('PAYU_MERCHANT_SALT is not configured');
    });

    it('verifies with udf fields present', async () => {
      const { verifyPayUResponse } = await import('@/lib/payu');

      // Reverse formula: salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|...
      const reverseString = `${MOCK_SALT}|success||||||field5|field4|field3|field2|field1|john@example.com|John|Test Product|100.00|txn123|${MOCK_KEY}`;
      const validHash = crypto.createHash('sha512').update(reverseString).digest('hex');

      const result = verifyPayUResponse({
        key: MOCK_KEY,
        txnid: 'txn123',
        amount: '100.00',
        productinfo: 'Test Product',
        firstname: 'John',
        email: 'john@example.com',
        status: 'success',
        hash: validHash,
        udf1: 'field1',
        udf2: 'field2',
        udf3: 'field3',
        udf4: 'field4',
        udf5: 'field5',
      });

      expect(result).toBe(true);
    });
  });

  describe('createPaymentLink', () => {
    it('returns correct form data structure', async () => {
      const { createPaymentLink } = await import('@/lib/payu');

      const result = createPaymentLink({
        amount: 1500,
        productInfo: 'Quote #Q-001',
        customerName: 'Rajesh Kumar',
        customerEmail: 'rajesh@company.com',
        customerPhone: '9876543210',
        txnId: 'NUCRM_Q001_abc123',
        successUrl: 'https://app.example.com/api/webhooks/payu?status=success',
        failureUrl: 'https://app.example.com/api/webhooks/payu?status=failure',
      });

      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('params');
      expect(result.action).toBe('https://test.payu.in/_payment');
      expect(result.params.key).toBe(MOCK_KEY);
      expect(result.params.txnid).toBe('NUCRM_Q001_abc123');
      expect(result.params.amount).toBe('1500.00');
      expect(result.params.productinfo).toBe('Quote #Q-001');
      expect(result.params.firstname).toBe('Rajesh Kumar');
      expect(result.params.email).toBe('rajesh@company.com');
      expect(result.params.phone).toBe('9876543210');
      expect(result.params.surl).toBe('https://app.example.com/api/webhooks/payu?status=success');
      expect(result.params.furl).toBe('https://app.example.com/api/webhooks/payu?status=failure');
      expect(result.params.hash).toBeDefined();
      expect(result.params.hash).toHaveLength(128);
    });

    it('formats amount to 2 decimal places', async () => {
      const { createPaymentLink } = await import('@/lib/payu');

      const result = createPaymentLink({
        amount: 99.9,
        productInfo: 'Test',
        customerName: 'Test',
        customerEmail: 'test@test.com',
        customerPhone: '1234567890',
        txnId: 'txn_test',
        successUrl: 'https://example.com/success',
        failureUrl: 'https://example.com/failure',
      });

      expect(result.params.amount).toBe('99.90');
    });

    it('uses production URL when PAYU_MODE is production', async () => {
      process.env['PAYU_MODE'] = 'production';
      const { createPaymentLink } = await import('@/lib/payu');

      const result = createPaymentLink({
        amount: 500,
        productInfo: 'Production Payment',
        customerName: 'Prod User',
        customerEmail: 'prod@company.com',
        customerPhone: '9999999999',
        txnId: 'txn_prod_001',
        successUrl: 'https://app.example.com/success',
        failureUrl: 'https://app.example.com/failure',
      });

      expect(result.action).toBe('https://secure.payu.in/_payment');
    });

    it('throws error when PAYU_MERCHANT_KEY is not set', async () => {
      delete process.env['PAYU_MERCHANT_KEY'];
      const { createPaymentLink } = await import('@/lib/payu');

      expect(() => createPaymentLink({
        amount: 100,
        productInfo: 'Test',
        customerName: 'Test',
        customerEmail: 'test@test.com',
        customerPhone: '1234567890',
        txnId: 'txn_test',
        successUrl: 'https://example.com/success',
        failureUrl: 'https://example.com/failure',
      })).toThrow('PAYU_MERCHANT_KEY is not configured');
    });

    it('generates a valid hash in the returned params', async () => {
      const { createPaymentLink, generatePayUHash } = await import('@/lib/payu');

      const result = createPaymentLink({
        amount: 750.50,
        productInfo: 'Premium Service',
        customerName: 'Amit Patel',
        customerEmail: 'amit@business.in',
        customerPhone: '8888888888',
        txnId: 'NUCRM_Q005_def456',
        successUrl: 'https://crm.example.com/success',
        failureUrl: 'https://crm.example.com/failure',
      });

      const expectedHash = generatePayUHash({
        key: MOCK_KEY,
        txnid: 'NUCRM_Q005_def456',
        amount: '750.50',
        productinfo: 'Premium Service',
        firstname: 'Amit Patel',
        email: 'amit@business.in',
      });

      expect(result.params.hash).toBe(expectedHash);
    });
  });
});
