import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, sessions, tenants, roles, tenantMembers, emailVerifications, pipelines, dealStages, platformSettings } from '@/drizzle/schema';
import { onboardingProgress } from '@/drizzle/schema';
import { isNull } from 'drizzle-orm';
import { eq, and } from 'drizzle-orm';
import { hashPassword, verifyPassword, createToken, hashToken, setSessionCookie, clearSessionCookie, validatePassword } from '@/lib/auth/session';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail, sendWebhookNotification, sendTelegram } from '@/lib/email/service';
import { devLogger } from '@/lib/dev-logger';
import { logger } from '@/lib/logger';
import { randomBytes, createHash, createHmac } from 'crypto';
import { installDefaultModules } from '@/lib/modules/auto-install';
import { isBlocked, recordFailedAttempt, recordSuccessfulLogin } from '@/lib/security/brute-force';
import { validateBody } from '@/lib/api/validate';
import { loginSchema, signupSchema } from '@/lib/api/schemas';

// ── Login ─────────────────────────────────────────────────────
export async function POST_login(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    const userAgent = request.headers.get('user-agent') ?? undefined;

    // Check if IP is blocked
    const ipBlockCheck = await isBlocked(ip, 'ip');
    if (ipBlockCheck.blocked) {
      return NextResponse.json({ 
        error: 'Too many login attempts. Please try again later.',
        blocked_until: ipBlockCheck.blockedUntil?.toISOString(),
        retry_after: Math.ceil((ipBlockCheck.blockedUntil?.getTime() ?? Date.now() - Date.now()) / 1000 / 60),
      }, { status: 429 });
    }

    const limited = await checkRateLimit(request, { action:'login', max:10, windowMinutes:15 });
    if (limited) return limited;

    const body = await request.json();
    const parsed = validateBody(loginSchema, body);
    if (parsed instanceof NextResponse) return parsed;
    const { email, password, remember_me } = parsed.data;

    // Check if email is blocked
    const emailBlockCheck = await isBlocked(email, 'email');
    if (emailBlockCheck.blocked) {
      return NextResponse.json({ 
        error: 'Too many login attempts for this account. Please try again later.',
        blocked_until: emailBlockCheck.blockedUntil?.toISOString(),
        retry_after: Math.ceil((emailBlockCheck.blockedUntil?.getTime() ?? Date.now() - Date.now()) / 1000 / 60),
      }, { status: 429 });
    }

    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.passwordHash || !await verifyPassword(password, user.passwordHash)) {
      await recordFailedAttempt(email, ip, userAgent, 'Invalid credentials');
      logger.warn('Login failed', { email, ip });
      return NextResponse.json({ error:'Invalid email or password' }, { status:401 });
    }

    // Record successful login
    await recordSuccessfulLogin(email, ip, userAgent);

    // Email verification check (soft — warn but don't block, unless platform requires it)
    const requireVerify = process.env['REQUIRE_EMAIL_VERIFY'] === 'true';
    if (requireVerify && !user.emailVerified && !user.isSuperAdmin) {
      return NextResponse.json({
        error: 'Please verify your email address before signing in.',
        needs_verification: true,
        email: user.email,
      }, { status: 403 });
    }

    // 2FA check
    if (user.totpEnabled) {
      const totpToken = body.totp_token;
      if (!totpToken) {
        return NextResponse.json({ requires_2fa: true, email: user.email }, { status: 200 });
      }
      
      const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = 0, val = 0; const kb: number[] = [];
      for (const ch of (user.totpSecret ?? '').toUpperCase()) {
        const idx = b32.indexOf(ch); if (idx === -1) continue;
        val = (val << 5) | idx; bits += 5;
        if (bits >= 8) { kb.push((val >>> (bits-8)) & 255); bits -= 8; }
      }
      const key = Buffer.from(kb);
      const ctr = Math.floor(Date.now() / 30000);
      let valid = false;
      for (let i = -1; i <= 1; i++) {
        const c = ctr + i; const buf = Buffer.alloc(8);
        buf.writeUInt32BE(Math.floor(c/0x100000000),0); buf.writeUInt32BE(c>>>0,4);
        const hmac = createHmac('sha1',key).update(buf).digest();
        const off = hmac[hmac.length-1]! & 0xf;
        const code = (((hmac[off]!)&0x7f)<<24|(hmac[off+1]!)<<16|(hmac[off+2]!)<<8|(hmac[off+3]!))%1000000;
        if (String(code).padStart(6,'0') === String(totpToken)) { valid = true; break; }
      }
      if (!valid && user.totpBackupCodes) {
        const hash = createHash('sha256').update(String(totpToken).toUpperCase()).digest('hex');
        const codes: string[] = typeof user.totpBackupCodes === 'string' ? JSON.parse(user.totpBackupCodes) : (user.totpBackupCodes as string[]);
        if (codes.includes(hash)) {
          valid = true;
          await db.update(users)
            .set({ totpBackupCodes: codes.filter((x:string)=>x!==hash) })
            .where(eq(users.id, user.id))
            .catch((e) => devLogger.warn('[Auth] Failed to update backup codes', e));
        }
      }
      if (!valid) return NextResponse.json({ error:'Invalid 2FA code', requires_2fa:true }, { status:401 });
    }

    // Create session
    const sessionDays = remember_me ? 30 : 1; // 30 days if remember me, 1 day otherwise
    const token = await createToken(user.id, sessionDays);
    const tokenHash = await hashToken(token);
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000),
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 255),
    });

    await setSessionCookie(token, sessionDays);
    const csrfToken = generateCsrfToken();
    const response = NextResponse.json({ 
      ok:true,
      user:{ id:user.id, email:user.email, full_name:user.fullName, is_super_admin:user.isSuperAdmin } 
    });
    response.headers.append('Set-Cookie', setCsrfCookie(csrfToken, process.env.NODE_ENV === 'production'));
    return response;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) {
    devLogger.error(err as Error, '[auth/login]');
    return NextResponse.json({ error:'Login failed. Please try again.' }, { status:500 });
  }
}

// ── Signup ────────────────────────────────────────────────────
export async function POST_signup(request: NextRequest) {
  try {
    // Rate limiting to prevent abuse
    const limited = await checkRateLimit(request, { action:'signup', max:5, windowMinutes:60 });
    if (limited) return limited;

    // Check if signups are allowed at platform level
    let allowSignups = true;
    try {
      const [allowSignupsSetting] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(and(eq(platformSettings.key, 'allow_signups'), isNull(platformSettings.tenantId)))
        .limit(1);
      allowSignups = allowSignupsSetting?.value !== 'false';
    } catch {
      // Silently skip during migration/setup when tables may not exist yet
      allowSignups = true;
    }
    
    if (!allowSignups) {
      return NextResponse.json({ error: 'Signups are currently disabled. Please contact support.' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = validateBody(signupSchema, body);
    if (parsed instanceof NextResponse) return parsed;
    const { email, password, full_name: fullName, workspace_name: workspaceName } = parsed.data;

    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return NextResponse.json({ error:'An account with this email already exists' }, { status:409 });

    const trialDays = parseInt(process.env.DEFAULT_TRIAL_DAYS ?? '14');
    
    const { user, tenant } = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({
        email,
        passwordHash: await hashPassword(password),
        fullName,
      }).returning();

      if (!u) throw new Error('Failed to create user');

      const base = workspaceName.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,40);
      const slug = `${base}-${Date.now().toString(36)}`;
      
      const [t] = await tx.insert(tenants).values({
        name: workspaceName,
        slug,
        ownerId: u.id,
        planId: 'free',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      }).returning();

      if (!t) throw new Error('Failed to create tenant');

      // CRITICAL: Create tenant_member row — user is ADMIN of their own org
      let adminRole;
      [adminRole] = await tx.select().from(roles).where(and(eq(roles.tenantId, t.id), eq(roles.slug, 'admin'))).limit(1);
      
      if (!adminRole) {
        [adminRole] = await tx.insert(roles).values({
          tenantId: t.id,
          slug: 'admin',
          name: 'Administrator',
          permissions: { all: true },
          isSystem: true,
        }).returning();
      }

      if (!adminRole) throw new Error('Failed to create admin role');

      await tx.insert(tenantMembers).values({
        tenantId: t.id,
        userId: u.id,
        roleId: adminRole.id,
        roleSlug: 'admin',
        status: 'active',
        joinedAt: new Date(),
      }).onConflictDoUpdate({
        target: [tenantMembers.tenantId, tenantMembers.userId],
        set: { status: 'active', roleId: adminRole.id, roleSlug: 'admin', updatedAt: new Date() }
      });

      // Set last_tenant_id so they land in their org after login
      await tx.update(users).set({ lastTenantId: t.id }).where(eq(users.id, u.id));

      // 1. Create Default Sales Pipeline
      const [pipeline] = await tx.insert(pipelines).values({
        tenantId: t.id,
        name: 'Sales Pipeline',
        isDefault: true,
      }).returning();

      if (!pipeline) throw new Error('Failed to create pipeline');

      // 2. Create Default Stages
      const defaultStages = [
        { name: 'Lead', order: 1 },
        { name: 'Qualified', order: 2 },
        { name: 'Proposal', order: 3 },
        { name: 'Negotiation', order: 4 },
        { name: 'Won', order: 5 },
        { name: 'Lost', order: 6 },
      ];

      for (const s of defaultStages) {
        await tx.insert(dealStages).values({
          pipelineId: pipeline.id,
          name: s.name,
          order: s.order,
        });
      }

      // 3. Create Default Roles (beyond admin) - with conflict handling
      const [existingSalesRep] = await tx.select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, t.id), eq(roles.slug, 'sales_rep')))
        .limit(1);

      if (!existingSalesRep) {
        await tx.insert(roles).values({
          tenantId: t.id,
          slug: 'sales_rep',
          name: 'Sales Representative',
          isSystem: false,
          sortOrder: 2,
          permissions: {
            'contacts.view': true, 'contacts.create': true, 'contacts.edit': true,
            'deals.view': true, 'deals.create': true, 'deals.edit': true,
            'tasks.view': true, 'tasks.create': true, 'tasks.manage': true,
          },
        });
      }

      // 4. Install plan-based default modules (covers core-crm, automation-basic, etc.)
      await installDefaultModules(t.id, 'free');
      
      // Normalized onboarding progress
      await tx.insert(onboardingProgress).values({
        tenantId: t.id,
        userId: u.id,
        stepName: 'account_created',
        isCompleted: true,
        completedAt: new Date(),
      }).onConflictDoNothing();

      return { user: u, tenant: t };
    });

    // Session
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    const userAgent = request.headers.get('user-agent') ?? undefined;
    const token = await createToken(user.id);
    const tokenHash = await hashToken(token);
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ipAddress: ip,
      userAgent: userAgent?.slice(0, 255),
    });
    await setSessionCookie(token);
    const signupCsrfToken = generateCsrfToken();
    const signupResponse = NextResponse.json({ ok:true, user:{ id:user.id, email:user.email, full_name:user.fullName }, tenant:{ id:tenant.id, name:tenant.name, slug:tenant.slug } }, { status:201 });
    signupResponse.headers.append('Set-Cookie', setCsrfCookie(signupCsrfToken, process.env.NODE_ENV === 'production'));

    // Send Discord/Slack webhook notification (fire-and-forget)
    sendWebhookNotification({
      title: '🎉 New User Signed Up',
      message: `**${user.fullName}** (${user.email}) joined\nWorkspace: **${tenant.name}** (\`${tenant.slug}\`)`,
      color: '#10b981',
      url: `${process.env.NEXT_PUBLIC_APP_URL}/tenant`,
    }).catch((e) => { console.error('[auth/signup] Webhook notification failed', e); });

    // Send Telegram notification if user configured it (fire-and-forget)
    sendTelegram({
      botToken: process.env['TELEGRAM_BOT_TOKEN'] || '',
      chatId: process.env['TELEGRAM_CHAT_ID'] || '',
      title: '🎉 New User Signed Up',
      message: `${user.fullName} (${user.email}) joined\nWorkspace: ${tenant.name} (${tenant.slug})`,
      icon: '🟢',
      url: `${process.env.NEXT_PUBLIC_APP_URL}/tenant`,
    }).catch((e) => { console.error('[auth/signup] Telegram notification failed', e); });

    // Send verification email (fire-and-forget)
    if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
      const vToken = randomBytes(32).toString('hex');
      const vHash = createHash('sha256').update(vToken).digest('hex');

      db.insert(emailVerifications).values({
        userId: user.id,
        tokenHash: vHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).then(() => {
        const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${vToken}`;
        sendEmail({
          to: email,
          subject: 'Verify your email address — NuCRM',
          html: `<p>Welcome to NuCRM! Click the link below to verify your email address:</p>
                 <a href="${verifyUrl}">${verifyUrl}</a>
                 <p>This link expires in 24 hours.</p>`,
        }).catch((err) => devLogger.error(err as Error, '[auth/signup] Failed to send verification email'));
      }).catch((err) => devLogger.error(err as Error, '[auth/signup] Failed to create verification token'));
    }

    return signupResponse;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err:any) {
    devLogger.error(err as Error, '[auth/signup]');
    return NextResponse.json({ error: err.message ?? 'Signup failed.' }, { status:500 });
  }
}

// ── Logout ────────────────────────────────────────────────────
export async function POST_logout(request: NextRequest) {
  try {
    const token = request.cookies.get('nucrm_session')?.value;
    if (token) {
      const tokenHash = await hashToken(token);
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).catch((e) => { console.error('[auth/logout] Failed to delete session', e); });
    }
    await clearSessionCookie();
    const logoutResponse = NextResponse.json({ ok:true });
    logoutResponse.headers.set('Set-Cookie', 'nucrm_csrf_token=; Path=/; SameSite=Strict; Max-Age=0');
    return logoutResponse;
  } catch (e) {
    console.error('[auth/logout] Logout error, clearing cookies anyway', e);
    await clearSessionCookie();
    const logoutResponse = NextResponse.json({ ok:true });
    logoutResponse.headers.set('Set-Cookie', 'nucrm_csrf_token=; Path=/; SameSite=Strict; Max-Age=0');
    return logoutResponse;
  }
}
