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
    PGBOUNCER_ENABLED?: string;
    DATABASE_POOL_SIZE?: string;
    DATABASE_STATEMENT_TIMEOUT?: string;
    SETUP_KEY?: string;
    SUPER_ADMIN_EMAIL?: string;
    /** @deprecated Use AI provider secrets vault (ai_provider_secrets table) instead */
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
    CRITICAL_ERROR_WEBHOOK_URL?: string;
    PAGERDUTY_ROUTING_KEY?: string;
    PAGERDUTY_ENABLED?: string;
    SLACK_WEBHOOK_URL?: string;
    DISCORD_WEBHOOK_URL?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    [key: string]: string | undefined;
  }
}

// Crypto module extensions
declare module 'crypto' {
  export function verifyPassword(password: string, hash: string): boolean;
  export function createHmac(algorithm: string, key: string | Buffer): Hmac;
}

// Window extensions for app-injected globals.
// NOTE: Do NOT add a `[key: string]: any` index signature here — it disables
// type-checking for every window access across the app. Declare specific
// properties instead (or co-locate them via `declare global` near their usage,
// as done in hooks/use-plan-features.ts).
interface Window {
  /** NuCRM plan feature flags injected by the server layout script. */
  __NUCRM_PLAN_FEATURES__?: string[];
  /** Whether the current session belongs to a super admin. */
  __NUCRM_IS_SUPER_ADMIN__?: boolean;
}
