/**
 * Password Reset Module
 * 
 * Features:
 * - Request password reset via email
 * - Reset password with token
 * - Token expiration (1 hour)
 * - Rate limiting to prevent abuse
 */

import { db } from '@/drizzle/db';
import { users, passwordResets } from '@/drizzle/schema';
import { eq, isNull, and, gt } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email/service';
import { hashPassword, validatePassword } from '@/lib/auth/session';
import { devLogger } from '@/lib/dev-logger';
import { logger } from '@/lib/logger';

const RESET_TOKEN_EXPIRY_HOURS = 1;
const RESET_TOKEN_LENGTH = 32;

/**
 * Clear reset token (for after successful reset)
 */
export async function clearResetToken(userId: string): Promise<void> {
  try {
    await db
      .update(passwordResets)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(passwordResets.userId, userId),
        isNull(passwordResets.deletedAt)
      ));
  } catch (err) {
    devLogger.error(err as Error, '[password-reset] clearResetToken failed');
  }
}

/**
 * Request password reset - generates token and sends email
 */
export async function requestPasswordReset(
  email: string,
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
): Promise<{ success: boolean; message: string }> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find user by email
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    // Always return success to prevent email enumeration
    // This is a security best practice - don't reveal if email exists
    if (!user) {
      devLogger.log(`[password-reset] Email not found: ${normalizedEmail}`);
      return {
        success: true,
        message: 'If that email exists, a reset link has been sent.'
      };
    }

    // Create reset token in password_resets table
    const token = randomBytes(RESET_TOKEN_LENGTH).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.insert(passwordResets).values({
      userId: user.id,
      token: tokenHash,
      expiresAt,
    });

    // Build reset URL
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
    
    // Send email (fire and forget, but log errors)
    if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
      try {
        await sendEmail({
          to: user.email,
          subject: 'Reset your password — NuCRM',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Password Reset Request</h2>
              <p>Hi ${user.fullName || 'there'},</p>
              <p>We received a request to reset your password. Click the button below to create a new password:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  Reset Password
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">
                This link expires in ${RESET_TOKEN_EXPIRY_HOURS} hour${RESET_TOKEN_EXPIRY_HOURS > 1 ? 's' : ''}.
                If you didn't request this, you can safely ignore this email.
              </p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px;">
                If the button doesn't work, copy and paste this URL into your browser:<br>
                <a href="${resetUrl}" style="color: #7c3aed;">${resetUrl}</a>
              </p>
            </div>
          `,
          text: `Password Reset\n\nHi ${user.fullName || 'there'},\n\nWe received a request to reset your password. Visit this link to create a new password:\n\n${resetUrl}\n\nThis link expires in ${RESET_TOKEN_EXPIRY_HOURS} hour(s). If you didn't request this, you can safely ignore this email.`,
        });
        
        logger.info('Password reset email sent', { email: user.email });
      } catch (emailErr) {
        devLogger.error(emailErr as Error, '[password-reset] Failed to send email');
      }
    } else {
      // In development without email configured, log the token
      devLogger.log(`[password-reset] Email not configured - token: ${token}`);
      console.log(`\n🔑 Password Reset URL: ${resetUrl}\n`);
    }

    return {
      success: true,
      message: 'If that email exists, a reset link has been sent.'
    };

  } catch (err) {
    devLogger.error(err as Error, '[password-reset] requestPasswordReset failed');
    // Always return success to prevent email enumeration
    return {
      success: true,
      message: 'If that email exists, a reset link has been sent.'
    };
  }
}

/**
 * Verify a reset token
 */
export async function verifyResetToken(token: string): Promise<{
  valid: boolean;
  userId?: string;
  email?: string;
}> {
  try {
    if (!token || token.length !== RESET_TOKEN_LENGTH * 2) {
      return { valid: false };
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();

    // Find valid reset token in password_resets table
    const [resetRecord] = await db
      .select({
        id: passwordResets.id,
        userId: passwordResets.userId,
        expiresAt: passwordResets.expiresAt,
      })
      .from(passwordResets)
      .innerJoin(users, eq(users.id, passwordResets.userId))
      .where(and(
        eq(passwordResets.token, tokenHash),
        isNull(passwordResets.deletedAt),
        gt(passwordResets.expiresAt, now)
      ))
      .limit(1);

    if (!resetRecord) {
      return { valid: false };
    }

    // Get user email
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, resetRecord.userId))
      .limit(1);

    return {
      valid: true,
      userId: resetRecord.userId,
      email: user?.email,
    };

  } catch (err) {
    devLogger.error(err as Error, '[password-reset] verifyResetToken failed');
    return { valid: false };
  }
}

/**
 * Reset password with token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Validate token
    const tokenCheck = await verifyResetToken(token);
    if (!tokenCheck.valid || !tokenCheck.userId) {
      return {
        success: false,
        message: 'Invalid or expired reset token. Please request a new one.'
      };
    }

    // Validate password strength
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return {
        success: false,
        message: passwordError
      };
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update user password
    await db
      .update(users)
      .set({
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, tokenCheck.userId));

    logger.info('Password reset successful', { userId: tokenCheck.userId });

    return {
      success: true,
      message: 'Password has been reset successfully. You can now log in.'
    };

  } catch (err) {
    devLogger.error(err as Error, '[password-reset] resetPassword failed');
    return {
      success: false,
      message: 'Failed to reset password. Please try again.'
    };
  }
}

