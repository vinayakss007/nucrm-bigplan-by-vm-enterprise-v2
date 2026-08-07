/**
 * PayU Payment Gateway Integration
 *
 * Provides utilities for generating payment links, hash verification,
 * and configuration management for the Indian market.
 *
 * Environment variables:
 * - PAYU_MERCHANT_KEY: Merchant key from PayU dashboard
 * - PAYU_MERCHANT_SALT: Merchant salt for hash generation
 * - PAYU_MODE: 'test' | 'production' (defaults to 'test')
 */
import crypto, { timingSafeEqual } from 'crypto';

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Returns true if both PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT are set.
 */
export function isPayUConfigured(): boolean {
  return !!(process.env['PAYU_MERCHANT_KEY'] && process.env['PAYU_MERCHANT_SALT']);
}

/**
 * Returns the PayU base URL based on the PAYU_MODE environment variable.
 * Defaults to test URL if PAYU_MODE is not 'production'.
 */
export function getPayUBaseUrl(): string {
  const mode = process.env['PAYU_MODE'] || 'test';
  if (mode === 'production') {
    return 'https://secure.payu.in/_payment';
  }
  return 'https://test.payu.in/_payment';
}

// ── Hash Generation & Verification ──────────────────────────────────────────

export interface PayUHashParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

/**
 * Generates PayU SHA-512 hash for payment request.
 * Formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
 */
export function generatePayUHash(params: PayUHashParams): string {
  const salt = process.env['PAYU_MERCHANT_SALT'];
  if (!salt) {
    throw new Error('PAYU_MERCHANT_SALT is not configured');
  }

  const hashString = [
    params.key,
    params.txnid,
    params.amount,
    params.productinfo,
    params.firstname,
    params.email,
    params.udf1 || '',
    params.udf2 || '',
    params.udf3 || '',
    params.udf4 || '',
    params.udf5 || '',
    '',    // udf6
    '',    // udf7
    '',    // udf8
    '',    // udf9
    '',    // udf10
    salt,
  ].join('|');

  return crypto.createHash('sha512').update(hashString).digest('hex');
}

export interface PayUResponseParams {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  status: string;
  hash: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  additionalCharges?: string;
}

/**
 * Verifies the reverse hash received from PayU callback.
 * Reverse formula: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 *
 * If additionalCharges is present, the formula becomes:
 * sha512(additionalCharges|salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 */
export function verifyPayUResponse(params: PayUResponseParams): boolean {
  const salt = process.env['PAYU_MERCHANT_SALT'];
  if (!salt) {
    throw new Error('PAYU_MERCHANT_SALT is not configured');
  }

  const parts: string[] = [];

  if (params.additionalCharges) {
    parts.push(params.additionalCharges);
  }

  parts.push(
    salt,
    params.status,
    '',    // udf10
    '',    // udf9
    '',    // udf8
    '',    // udf7
    '',    // udf6
    params.udf5 || '',
    params.udf4 || '',
    params.udf3 || '',
    params.udf2 || '',
    params.udf1 || '',
    params.email,
    params.firstname,
    params.productinfo,
    params.amount,
    params.txnid,
    params.key,
  );

  const hashString = parts.join('|');
  const calculatedHash = crypto.createHash('sha512').update(hashString).digest('hex');

  // Timing-safe comparison to prevent timing attacks
  const stored = Buffer.from(calculatedHash, 'hex');
  const provided = Buffer.from(params.hash, 'hex');
  if (stored.length !== provided.length) return false;
  return timingSafeEqual(stored, provided);
}

// ── Payment Link Creation ────────────────────────────────────────────────────

export interface CreatePaymentLinkOptions {
  amount: number;
  productInfo: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  txnId: string;
  successUrl: string;
  failureUrl: string;
}

export interface PayUFormData {
  action: string;
  params: {
    key: string;
    txnid: string;
    amount: string;
    productinfo: string;
    firstname: string;
    email: string;
    phone: string;
    surl: string;
    furl: string;
    hash: string;
  };
}

/**
 * Creates payment link form data for redirecting the user to PayU.
 * Returns the PayU URL and all form parameters needed for a POST redirect.
 */
export function createPaymentLink(options: CreatePaymentLinkOptions): PayUFormData {
  const key = process.env['PAYU_MERCHANT_KEY'];
  if (!key) {
    throw new Error('PAYU_MERCHANT_KEY is not configured');
  }

  const amount = options.amount.toFixed(2);

  const hashParams: PayUHashParams = {
    key,
    txnid: options.txnId,
    amount,
    productinfo: options.productInfo,
    firstname: options.customerName,
    email: options.customerEmail,
  };

  const hash = generatePayUHash(hashParams);

  return {
    action: getPayUBaseUrl(),
    params: {
      key,
      txnid: options.txnId,
      amount,
      productinfo: options.productInfo,
      firstname: options.customerName,
      email: options.customerEmail,
      phone: options.customerPhone,
      surl: options.successUrl,
      furl: options.failureUrl,
      hash,
    },
  };
}
