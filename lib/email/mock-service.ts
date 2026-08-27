/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Mock Email Service for Local Development
 * 
 * During development, this service logs emails to console instead of sending them.
 * In production, switch to Resend or SMTP service.
 * 
 * Usage:
 * import { emailService } from '@/lib/email/service';
 * await emailService.send({ to, subject, html });
 */

import crypto from 'crypto';
import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export interface EmailService {
  send(options: EmailOptions): Promise<boolean>;
  sendVerificationEmail(email: string, token: string): Promise<boolean>;
  sendPasswordReset(email: string, token: string): Promise<boolean>;
  sendWelcomeEmail(email: string, name: string): Promise<boolean>;
}

/**
 * Mock email service - logs to console
 */
class MockEmailService implements EmailService {
  private testMode = process.env['RESEND_TEST_MODE'] === 'true' || !process.env['RESEND_API_KEY'];

  // #1278: cache the SMTP transporter so it is created once and reused across
  // sends instead of building a fresh one on every call. Mirrors the caching in
  // lib/email/service.ts, keyed by a hash of the SMTP config so a credential
  // change transparently rebuilds the transporter instead of reusing stale auth.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transporter: any = null;
  private transporterConfig: string | null = null;

  private getTransporter() {
    const host = process.env.SMTP_HOST || 'smtp.resend.com';
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER || 'resend';
    const pass = process.env.RESEND_API_KEY;

    const currentConfig = crypto
      .createHash('sha256')
      .update(`${host}|${port}|${user}|${pass ?? ''}`)
      .digest('hex');

    if (!this.transporter || this.transporterConfig !== currentConfig) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: false,
        auth: {
          user,
          pass,
        },
      });
      this.transporterConfig = currentConfig;
    }

    return this.transporter;
  }

  async send(options: EmailOptions): Promise<boolean> {
    if (this.testMode) {
      console.log('📧 [MOCK EMAIL] Would send to:', Array.isArray(options.to) ? options.to.join(', ') : options.to);
      console.log('📧 [MOCK EMAIL] Subject:', options.subject);
      console.log('📧 [MOCK EMAIL] Body preview:', options.html.slice(0, 200) + '...');
      console.log('─────────────────────────────────────');
      return true;
    }

    // In production with Resend, implement actual sending
    try {
      const transporter = this.getTransporter();

      await transporter.sendMail({
        from: options.from || process.env.SMTP_FROM_NAME || 'NuCRM <noreply@yourdomain.com>',
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      console.log('✅ Email sent successfully to:', options.to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send email:', error);
      return false;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify?token=${token}`;
    
    return this.send({
      to: email,
      subject: 'Verify Your Email - NuCRM',
      html: `
        <h1>Welcome to NuCRM!</h1>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
          Verify Email
        </a>
        <p>Or copy this link: ${verifyUrl}</p>
        <p>This link expires in 24 hours.</p>
      `,
      text: `Welcome to NuCRM! Verify your email: ${verifyUrl}`,
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<boolean> {
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${token}`;
    
    return this.send({
      to: email,
      subject: 'Reset Your Password - NuCRM',
      html: `
        <h1>Password Reset Request</h1>
        <p>Click the button below to reset your password:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px;">
          Reset Password
        </a>
        <p>Or copy this link: ${resetUrl}</p>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
      text: `Reset your password: ${resetUrl}`,
    });
  }

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    return this.send({
      to: email,
      subject: 'Welcome to NuCRM! 🎉',
      html: `
        <h1>Welcome to NuCRM, ${name}!</h1>
        <p>We're excited to have you on board.</p>
        <h2>Getting Started:</h2>
        <ul>
          <li>Add your first contact</li>
          <li>Create a company profile</li>
          <li>Set up your sales pipeline</li>
          <li>Invite team members</li>
        </ul>
        <p>Need help? Check out our <a href="${process.env.NEXT_PUBLIC_APP_URL}/docs">documentation</a>.</p>
      `,
      text: `Welcome to NuCRM, ${name}! Get started at ${process.env.NEXT_PUBLIC_APP_URL}`,
    });
  }
}

/**
 * Create email service based on environment
 */
export function createEmailService(): EmailService {
  return new MockEmailService();
}

// Default export
export const emailService = createEmailService();

export default emailService;
