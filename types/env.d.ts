/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Environment variables
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    DATABASE_SSL: string;
    JWT_SECRET: string;
    CRON_SECRET: string;
    NEXT_PUBLIC_APP_URL: string;
    RESEND_API_KEY?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    SMTP_FROM_NAME?: string;
    SMTP_FROM_EMAIL?: string;
    BACKUP_LOCAL_DIR?: string;
    BACKUP_BUCKET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_REGION?: string;
    AWS_ENDPOINT_URL?: string;
    BACKUP_RETENTION_DAYS?: string;
    SETUP_KEY?: string;
    SUPER_ADMIN_EMAIL?: string;
    ANTHROPIC_API_KEY?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
    DEFAULT_TRIAL_DAYS?: string;
    BREVO_SMTP_HOST?: string;
    BREVO_SMTP_USER?: string;
    R2_BUCKET?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_ACCOUNT_ID?: string;
    AWS_S3_BUCKET?: string;
    RESEND_WEBHOOK_SECRET?: string;
    [key: string]: string | undefined;
  }
}

// Crypto module extensions
declare module 'crypto' {
  export function verifyPassword(password: string, hash: string): boolean;
  export function createHmac(algorithm: string, key: string | Buffer): Hmac;
}

// Process extensions
interface Window {
  [key: string]: any;
}
