/**
 * Login & Security Policy
 *   GET   /api/tenant/admin/login-policy
 *   PATCH /api/tenant/admin/login-policy
 *
 * Storage: tenants.settings.login_policy  (jsonb_set merge — never clobbers other keys)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const DEFAULTS = {
  password: {
    min_length: 12,
    require_uppercase: true,
    require_number: true,
    require_symbol: true,
    max_age_days: 0,            // 0 = never expires
    prevent_reuse_count: 5,     // remember last N passwords
  },
  two_factor: {
    enforcement: 'optional' as 'off' | 'optional' | 'required',
    grace_period_days: 7,        // when 'required', allow N days for users to set up
  },
  session: {
    idle_timeout_minutes: 60,    // 0 = no idle timeout
    max_lifetime_hours: 24,      // hard cap
    max_concurrent: 5,           // 0 = unlimited
  },
  network: {
    ip_allowlist_enabled: false,
    ip_allowlist: [] as string[], // CIDR strings
  },
  login: {
    allow_self_signup: false,
    allowed_email_domains: [] as string[], // e.g. ['acme.com'] — empty = all allowed
    blocked_email_domains: [] as string[],
  },
};

const VALID_2FA = ['off', 'optional', 'required'];

function isCIDR(s: string) {
  return /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(s)
      || /^[0-9a-fA-F:]+(?:\/\d{1,3})?$/.test(s);
}

function isDomain(s: string) {
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s) && s.length <= 253;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const stored = (((t?.settings as Record<string, unknown>) ?? {}).login_policy ?? {}) as Record<string, unknown>;

    // Deep-merge defaults <- stored
    const merged = {
      password:    { ...DEFAULTS.password,    ...(stored['password']    ?? {}) },
      two_factor:  { ...DEFAULTS.two_factor,  ...(stored['two_factor']  ?? {}) },
      session:     { ...DEFAULTS.session,     ...(stored['session']     ?? {}) },
      network:     { ...DEFAULTS.network,     ...(stored['network']     ?? {}) },
      login:       { ...DEFAULTS.login,       ...(stored['login']       ?? {}) },
    };

    return NextResponse.json({ login_policy: merged });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const incoming = body.login_policy;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'login_policy object required' }, { status: 400 });

    const safe: Record<string, unknown> = {};

    // Password
    if (incoming.password && typeof incoming.password === 'object') {
      const p = incoming.password;
      const minLen = Number(p.min_length ?? DEFAULTS.password.min_length);
      if (!Number.isInteger(minLen) || minLen < 6 || minLen > 128)
        return NextResponse.json({ error: 'password.min_length must be 6-128' }, { status: 400 });
      const maxAge = Number(p.max_age_days ?? 0);
      if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 3650)
        return NextResponse.json({ error: 'password.max_age_days must be 0-3650' }, { status: 400 });
      const reuse = Number(p.prevent_reuse_count ?? 0);
      if (!Number.isInteger(reuse) || reuse < 0 || reuse > 24)
        return NextResponse.json({ error: 'password.prevent_reuse_count must be 0-24' }, { status: 400 });
      safe['password'] = {
        min_length: minLen,
        require_uppercase: p.require_uppercase === true,
        require_number:    p.require_number    === true,
        require_symbol:    p.require_symbol    === true,
        max_age_days:      maxAge,
        prevent_reuse_count: reuse,
      };
    }

    // 2FA
    if (incoming.two_factor && typeof incoming.two_factor === 'object') {
      const t = incoming.two_factor;
      if (t.enforcement && !VALID_2FA.includes(t.enforcement))
        return NextResponse.json({ error: `two_factor.enforcement must be one of ${VALID_2FA.join(', ')}` }, { status: 400 });
      const grace = Number(t.grace_period_days ?? DEFAULTS.two_factor.grace_period_days);
      if (!Number.isInteger(grace) || grace < 0 || grace > 90)
        return NextResponse.json({ error: 'two_factor.grace_period_days must be 0-90' }, { status: 400 });
      safe['two_factor'] = {
        enforcement: t.enforcement ?? DEFAULTS.two_factor.enforcement,
        grace_period_days: grace,
      };
    }

    // Session
    if (incoming.session && typeof incoming.session === 'object') {
      const s = incoming.session;
      const idle = Number(s.idle_timeout_minutes ?? 0);
      if (!Number.isInteger(idle) || idle < 0 || idle > 1440)
        return NextResponse.json({ error: 'session.idle_timeout_minutes must be 0-1440' }, { status: 400 });
      const life = Number(s.max_lifetime_hours ?? 24);
      if (!Number.isInteger(life) || life < 1 || life > 720)
        return NextResponse.json({ error: 'session.max_lifetime_hours must be 1-720' }, { status: 400 });
      const conc = Number(s.max_concurrent ?? 0);
      if (!Number.isInteger(conc) || conc < 0 || conc > 50)
        return NextResponse.json({ error: 'session.max_concurrent must be 0-50' }, { status: 400 });
      safe['session'] = { idle_timeout_minutes: idle, max_lifetime_hours: life, max_concurrent: conc };
    }

    // Network / IP allowlist
    if (incoming.network && typeof incoming.network === 'object') {
      const n = incoming.network;
      const list = Array.isArray(n.ip_allowlist) ? n.ip_allowlist : [];
      const cleaned: string[] = [];
      for (const raw of list) {
        const v = String(raw).trim();
        if (!v) continue;
        if (!isCIDR(v))
          return NextResponse.json({ error: `IP/CIDR not valid: ${v}` }, { status: 400 });
        cleaned.push(v);
      }
      if (cleaned.length > 200)
        return NextResponse.json({ error: 'Max 200 IP entries' }, { status: 400 });
      safe['network'] = {
        ip_allowlist_enabled: n.ip_allowlist_enabled === true,
        ip_allowlist: cleaned,
      };
    }

    // Login policy
    if (incoming.login && typeof incoming.login === 'object') {
      const l = incoming.login;
      const allowed = Array.isArray(l.allowed_email_domains) ? l.allowed_email_domains : [];
      const blocked = Array.isArray(l.blocked_email_domains) ? l.blocked_email_domains : [];
      for (const d of [...allowed, ...blocked]) {
        const v = String(d).trim().toLowerCase();
        if (v && !isDomain(v))
          return NextResponse.json({ error: `Email domain not valid: ${d}` }, { status: 400 });
      }
      safe['login'] = {
        allow_self_signup: l.allow_self_signup === true,
        allowed_email_domains: allowed.map((d: string) => String(d).trim().toLowerCase()).filter(Boolean),
        blocked_email_domains: blocked.map((d: string) => String(d).trim().toLowerCase()).filter(Boolean),
      };
    }

    // Merge into tenants.settings.login_policy preserving existing sub-keys we didn't touch
    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{login_policy}',
            COALESCE(${tenants.settings}->'login_policy', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_login_policy', entityType: 'tenant',
      newData: safe,
    });

    return NextResponse.json({ ok: true, login_policy: safe });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[login-policy PATCH]', err);
    return apiError(err);
  }
}
