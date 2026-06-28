/**
 * Data Loss Prevention (DLP) Controls
 *
 * Prevents sensitive data from being exported or leaked:
 * - PII detection and masking
 * - Export logging for audit trails
 * - Configurable sensitive fields per tenant
 */

import { db } from '@/drizzle/db';
import { systemSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

// Default sensitive fields that should be masked in exports
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'password_hash',
  'totpSecret',
  'totp_secret',
  'totpBackupCodes',
  'totp_backup_codes',
  'resetToken',
  'reset_token',
  'emailVerifyToken',
  'email_verify_token',
  'encryptionKey',
  'encryption_key',
  'secretKey',
  'secret_key',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'stripeCustomerId',
  'stripe_customer_id',
  'stripeSubscriptionId',
  'stripe_subscription_id',
];

// PII field patterns
const PII_PATTERNS = {
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  phone: /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/,
  ssn: /^\d{3}-?\d{2}-?\d{4}$/,
  creditCard: /^\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}$/,
  ipAddress: /^(\d{1,3}\.){3}\d{1,3}$/,
};

export interface DlpConfig {
  tenantId?: string;
  maskSensitiveFields: boolean;
  logExports: boolean;
  maxExportRows: number;
  allowedExportFormats: string[];
  sensitiveFieldOverrides: string[];
}

export interface DlpCheckResult {
  allowed: boolean;
  reason?: string;
  maskedFields: string[];
}

/**
 * Get DLP configuration for a tenant
 */
export async function getDlpConfig(tenantId?: string): Promise<DlpConfig> {
  const defaultConfig: DlpConfig = {
    maskSensitiveFields: true,
    logExports: true,
    maxExportRows: 10000,
    allowedExportFormats: ['csv', 'xlsx', 'json'],
    sensitiveFieldOverrides: [],
  };

  try {
    const setting = await db.query.systemSettings.findFirst({
      where: tenantId
        ? eq(systemSettings.key, 'dlp_config')
        : eq(systemSettings.key, 'dlp_config'),
      columns: { value: true },
    });

    if (setting?.value) {
      const config = typeof setting.value === 'string'
        ? JSON.parse(setting.value)
        : setting.value;
      return { ...defaultConfig, ...config };
    }
  } catch {
    // Return defaults on error
  }

  return defaultConfig;
}

/**
 * Check if export is allowed
 */
export async function checkExportAllowed(
  tenantId: string | null,
  format: string,
  rowCount: number
): Promise<DlpCheckResult> {
  const config = await getDlpConfig(tenantId || undefined);

  if (!config.allowedExportFormats.includes(format)) {
    return {
      allowed: false,
      reason: `Export format '${format}' is not allowed. Allowed: ${config.allowedExportFormats.join(', ')}`,
      maskedFields: [],
    };
  }

  if (rowCount > config.maxExportRows) {
    return {
      allowed: false,
      reason: `Export exceeds maximum rows (${config.maxExportRows}). Requested: ${rowCount}`,
      maskedFields: [],
    };
  }

  return { allowed: true, maskedFields: [] };
}

/**
 * Mask sensitive data in an object
 */
export function maskSensitiveData<T extends Record<string, unknown>>(
  data: T,
  sensitiveFields: string[] = []
): { masked: T; maskedFields: string[] } {
  const allSensitive = [...DEFAULT_SENSITIVE_FIELDS, ...sensitiveFields];
  const maskedFields: string[] = [];
  const masked = { ...data };

  for (const field of allSensitive) {
    if (field in masked && masked[field] !== null && masked[field] !== undefined) {
      (masked as Record<string, unknown>)[field] = '***REDACTED***';
      maskedFields.push(field);
    }
  }

  return { masked, maskedFields };
}

/**
 * Mask PII data in a string value
 */
export function maskPii(value: string): string {
  if (!value || typeof value !== 'string') return value;

  if (PII_PATTERNS.email.test(value)) {
    const [local, domain] = value.split('@');
    return `${local.charAt(0)}***@${domain}`;
  }

  if (PII_PATTERNS.phone.test(value)) {
    return value.slice(0, 3) + '***' + value.slice(-2);
  }

  if (PII_PATTERNS.ssn.test(value)) {
    return '***-**-' + value.slice(-4);
  }

  if (PII_PATTERNS.creditCard.test(value)) {
    return '****-****-****-' + value.slice(-4);
  }

  if (PII_PATTERNS.ipAddress.test(value)) {
    const parts = value.split('.');
    return `${parts[0]}.${parts[1]}.***.***`;
  }

  return value;
}

/**
 * Process export data with DLP controls
 */
export async function processExportData<T extends Record<string, unknown>>(
  tenantId: string | null,
  data: T[],
  format: string,
  additionalSensitiveFields: string[] = []
): Promise<{ processedData: T[]; maskedFields: string[]; exportLogged: boolean }> {
  const config = await getDlpConfig(tenantId || undefined);

  if (!config.maskSensitiveFields) {
    return { processedData: data, maskedFields: [], exportLogged: false };
  }

  const allMaskedFields: string[] = [];
  const processedData = data.map(row => {
    const { masked, maskedFields } = maskSensitiveData(row, [
      ...config.sensitiveFieldOverrides,
      ...additionalSensitiveFields,
    ]);
    allMaskedFields.push(...maskedFields);
    return masked;
  });

  return {
    processedData,
    maskedFields: [...new Set(allMaskedFields)],
    exportLogged: config.logExports,
  };
}

/**
 * Log export activity for audit trail
 */
export async function logExportActivity(
  tenantId: string,
  userId: string,
  exportType: string,
  format: string,
  rowCount: number,
  maskedFields: string[],
  ipAddress?: string
): Promise<void> {
  try {
    await db.insert(systemSettings).values({
      key: `export_log:${Date.now()}`,
      value: JSON.stringify({
        tenantId,
        userId,
        exportType,
        format,
        rowCount,
        maskedFields,
        ipAddress,
        timestamp: new Date().toISOString(),
      }),
      tenantId: null,
    });
  } catch (err) {
    console.error('[DLP] Failed to log export activity:', err);
  }
}
