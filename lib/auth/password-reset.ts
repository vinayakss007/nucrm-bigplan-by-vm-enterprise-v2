import { getAppUrl } from '../app-url';
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Password Reset Module
 * 
 * Features:
 * - Request password reset via email
 * - Reset password with token
 * - Token expiration (1 hour)
 * - Rate limiting to prevent abuse
 */

import { users, passwordResets, sessions } from '@/drizzle/schema';
import { db } from '@/drizzle/db';
import { eq, isNull, and, gt } from 'drizzle-orm';
import { withAuthLookupContext, setTokenIssueContext, setUserContext, withTokenIssueContext } from '@/lib/db/rls';
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
    // PP-026: password_resets only carried `password_resets_user_own`, which
    // keys off app.current_user — but a reset is authorised by the token, not by
    // a session, so no user context exists here. Runs with the token_issue
    // privilege that admits UPDATE on password_resets without an authenticated
    // user (0134).
    await withTokenIssueContext(async (tx) =>
      await tx
      .update(passwordResets)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(passwordResets.userId, userId),
        isNull(passwordResets.deletedAt)
      ))
    );
  } catch (err) {
    devLogger.error(err as Error, '[password-reset] clearResetToken failed');
  }
}

/**
 * Request password reset - generates token and sends email
 */
export async function requestPasswordReset(
  email: string,
  appUrl: string = getAppUrl()
): Promise<{ success: boolean; message: string }> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Find user by email
    // PP-026: pre-auth lookup by email, so it needs the auth_lookup privilege
  // (users_auth_lookup). Without it RLS returned zero rows and this function
  // silently reported success having created no token at all.
  const [user] = await withAuthLookupContext(async (tx) =>
      await tx
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    );

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

    // #3075: at most one live token per user. The old shape inserted
    // alongside any still-live tokens from earlier requests, so several
    // reset links were redeemable at once — and until the expiry window each
    // old URL was a standing credential. Retire the previous tokens in the
    // same platform-security context that owns this table (PP-026).
    await withTokenIssueContext(async (tx) => {
      await tx
        .update(passwordResets)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(passwordResets.userId, user.id),
          isNull(passwordResets.deletedAt)
        ));
      await tx.insert(passwordResets).values({
        userId: user.id,
        token: tokenHash,
        expiresAt,
      });
    });

    // Build reset URL
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
    
    // Send email (fire and forget, but log errors)
    if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
      try {
        // #3045 doctrine: sendEmail resolves {success:false} on provider
        // rejection and never throws, so the catch below never saw a failed
        // send. #3076: check the result; the response body stays the
        // enumeration-safe constant.
        const emailResult = await sendEmail({
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
        if (emailResult.success) {
          logger.info('Password reset email sent', { email: user.email });
        } else {
          devLogger.error(new Error(`[password-reset] reset email rejected: ${emailResult.error ?? 'unknown'}`), '[password-reset] Failed to send email');
        }
      } catch (emailErr) {
        // Genuine throws (a broken import, an unexpected rejection) still land here.
        devLogger.error(emailErr as Error, '[password-reset] Failed to send email');
      }
    } else {
      // In development without email configured, surface the token in the
      // server console only — never the full reset URL (#1259: URLs leak via
      // log aggregation; the token alone is enough for local dev flows).
      devLogger.log('[password-reset] Email not configured - DEV ONLY. Check DB password_resets table for the active token.');
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
    const [resetRecord] = await withAuthLookupContext(async (tx) =>
      await tx
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
      .limit(1)
    );

    if (!resetRecord) {
      return { valid: false };
    }

    // Get user email
    const [user] = await withAuthLookupContext(async (tx) =>
      await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, resetRecord.userId))
      .limit(1)
    );

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
    // Password strength is validated BEFORE the token is claimed so a weak
    // password never burns a live token.
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return {
        success: false,
        message: passwordError
      };
    }

    if (!token || token.length !== RESET_TOKEN_LENGTH * 2) {
      return {
        success: false,
        message: 'Invalid or expired reset token. Please request a new one.'
      };
    }

    const passwordHash = await hashPassword(newPassword);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // #3075: single atomic claim, mirroring app/api/auth/reset-password
    // (#1215). The old shape verified via SELECT, changed the password, then
    // cleared the token through a helper whose failure was swallowed — two
    // concurrent requests with the same link both succeeded, and any token
    // left live until expiry. The conditional UPDATE ... RETURNING lets
    // exactly one redemption win; on the win it also consumes every other
    // still-live token for that user, and session invalidation moves inside
    // the same transaction (its failure now rolls the whole reset back
    // instead of being console.error'd away).
    //
    // Pre-auth by construction: the claim runs under app.token_issue (the
    // narrow privilege that admits UPDATE/INSERT on password_resets without an
    // authenticated user). Once the row is claimed we know userId and switch
    // to app.current_user for the users/sessions writes.
    const resetUserId = await db.transaction(async (tx) => {
      await setTokenIssueContext(tx);
      const [claimed] = await tx
        .update(passwordResets)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(passwordResets.token, tokenHash),
          isNull(passwordResets.deletedAt),
          gt(passwordResets.expiresAt, new Date())
        ))
        .returning({ userId: passwordResets.userId });

      if (!claimed) return null;

      await setUserContext(claimed.userId, tx);

      await tx
        .update(users)
        .set({
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, claimed.userId));

      await tx
        .delete(sessions)
        .where(eq(sessions.userId, claimed.userId));

      await tx
        .update(passwordResets)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(passwordResets.userId, claimed.userId),
          isNull(passwordResets.deletedAt)
        ));

      return claimed.userId;
    });

    if (!resetUserId) {
      return {
        success: false,
        message: 'Invalid or expired reset token. Please request a new one.'
      };
    }

    logger.info('Password reset successful', { userId: resetUserId });

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

