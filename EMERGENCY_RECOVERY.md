# NuCRM Emergency Recovery Playbook

This document covers **every failure scenario** and the exact steps to recover. Keep this accessible to your ops team — print it, save it offline, store it in your password manager notes.

---

## Quick Reference: Recovery Decision Tree

```
User can't login
├── Forgot password? → Section 1
│   ├── Email arrives? → Click reset link → done
│   └── Email NOT arriving? → Section 2
├── 2FA device lost? → Section 3
│   ├── Backup codes available? → Use backup code → done
│   └── No backup codes? → Section 3B
├── Account suspended? → Section 4
├── Super admin locked out completely? → Section 5 (EMERGENCY)
└── Data lost / accidentally deleted? → Section 6
```

---

## Section 1: Forgot Password (Normal Flow)

**Scenario:** User forgot their password. Email is working.

**Steps:**
1. Go to `/auth/forgot-password`
2. Enter email address
3. Check inbox (and spam folder) for reset email
4. Click link (expires in 1 hour)
5. Set new password (12+ characters)

**API:** `POST /api/auth/forgot-password` — rate limited to 3 requests/hour

**If email doesn't arrive:** See Section 2.

---

## Section 2: Password Reset Email Not Arriving

**Scenario:** User requests password reset but never receives the email.

### Diagnose:
1. Check spam/junk folder
2. Check if email provider blocks the sender domain
3. Verify SMTP is configured: check server logs for `[Email]` entries
4. Check Resend/SMTP dashboard for delivery status

### Solutions (in order):

**A) Fix SMTP and resend:**
```bash
# Check SMTP config
echo $SMTP_HOST $SMTP_PORT $SMTP_USER

# Verify Resend API key
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -d '{"from":"test@yourdomain.com","to":"admin@yourdomain.com","subject":"Test","text":"SMTP works"}'
```

**B) Admin resets password via Super Admin panel:**
1. Login as super admin → `/superadmin/users`
2. Find the user
3. Use "Edit" to reset their password manually

**C) Direct database reset (if no admin access):**
```bash
# Generate bcrypt hash for new password
node -e "const b=require('bcryptjs');b.hash('NewSecurePassword123!',12).then(h=>console.log(h))"

# Update directly in PostgreSQL
psql $DATABASE_URL -c "UPDATE users SET password_hash='PASTE_HASH_HERE' WHERE email='user@example.com';"
```

**D) Emergency Recovery API (if configured):**
```bash
curl -X POST http://your-server/api/emergency/recover \
  -H "Content-Type: application/json" \
  -d '{
    "emergency_key": "YOUR_EMERGENCY_RECOVERY_KEY",
    "email": "admin@yourdomain.com",
    "new_password": "NewSecurePassword123!"
  }'
```

---

## Section 3: 2FA Device Lost

**Scenario:** User enabled TOTP 2FA but lost their authenticator device.

### 3A: Backup Codes Available
1. On the 2FA verification screen, click "Use backup code"
2. Enter one of the 10 backup codes provided at setup
3. After login, go to Settings → Security → Disable 2FA
4. Re-enable with new device

### 3B: No Backup Codes, No Device

**If another admin exists:**
1. Admin logs in → Settings → Team → find user → "Reset 2FA"
2. Or via API: `PATCH /api/tenant/team/:userId` with `{ disable_2fa: true }`

**If ONLY super admin and locked out:**
```bash
# Option 1: Emergency Recovery API (disables 2FA + resets password)
curl -X POST http://your-server/api/emergency/recover \
  -H "Content-Type: application/json" \
  -d '{
    "emergency_key": "YOUR_EMERGENCY_RECOVERY_KEY",
    "email": "admin@yourdomain.com",
    "new_password": "NewSecurePassword123!",
    "disable_2fa": true
  }'

# Option 2: Direct database (nuclear option)
psql $DATABASE_URL -c "
  UPDATE users SET
    totp_enabled = false,
    totp_secret = NULL,
    totp_backup_codes = NULL
  WHERE email = 'admin@yourdomain.com';
"
```

---

## Section 4: Account Suspended / Trial Expired

**Scenario:** Tenant or user account is suspended/expired.

### Tenant suspended by super admin:
1. Super admin → `/superadmin/tenants` → Find tenant → "Activate"
2. Or API: `PATCH /api/superadmin/tenants` with `{ id: "...", status: "active" }`

### Trial expired:
1. Super admin → Extend trial: click "+Days" button
2. Or upgrade to paid plan via Settings → Billing
3. Or API: `PATCH /api/superadmin/tenants` with `{ id: "...", trial_ends_at: "2026-12-31", status: "trialing" }`

### Direct DB fix:
```sql
-- Reactivate tenant
UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = 'tenant-id-here';

-- Extend trial by 30 days
UPDATE tenants SET trial_ends_at = NOW() + INTERVAL '30 days', status = 'trialing' WHERE id = 'tenant-id-here';
```

---

## Section 5: Super Admin Completely Locked Out (EMERGENCY)

**Scenario:** The only super admin cannot access the system through any normal means.

### Prerequisites:
- You have server/SSH access
- You have `DATABASE_URL` connection string
- You have set `EMERGENCY_RECOVERY_KEY` in the environment

### Recovery Steps:

**Step 1: Try Emergency Recovery API**
```bash
# Check if endpoint is configured
curl http://your-server/api/emergency/recover

# Reset password + disable 2FA
curl -X POST http://your-server/api/emergency/recover \
  -H "Content-Type: application/json" \
  -d '{
    "emergency_key": "YOUR_64_CHAR_SECRET",
    "email": "admin@yourdomain.com",
    "new_password": "NewSecureP@ssw0rd!2026",
    "disable_2fa": true
  }'
```

**Step 2: If API is unreachable (app is down)**
```bash
# Connect directly to database
psql $DATABASE_URL

# Find your admin account
SELECT id, email, full_name, is_super_admin, totp_enabled FROM users WHERE is_super_admin = true;

# Generate new password hash
# (run in a separate terminal)
node -e "require('bcryptjs').hash('EmergencyP@ss2026!', 12).then(h => console.log(h))"

# Reset everything
UPDATE users SET
  password_hash = '$2a$12$YOUR_GENERATED_HASH_HERE',
  totp_enabled = false,
  totp_secret = NULL,
  totp_backup_codes = NULL,
  updated_at = NOW()
WHERE email = 'admin@yourdomain.com';

# Clear any active sessions (force re-login)
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'admin@yourdomain.com');
```

**Step 3: If database is also unreachable**
```bash
# Check PostgreSQL status
systemctl status postgresql
# or
docker compose ps postgres

# Restart database
systemctl restart postgresql
# or
docker compose restart postgres

# If using Neon/managed DB: check provider dashboard for outages
```

**Step 4: If EVERYTHING is down (nuclear recovery)**
1. Restore database from latest backup (auto-backup runs hourly)
2. `npm run db:migrate` to ensure schema is current
3. Restart app: `pm2 restart all` or `docker compose up -d`
4. Use Step 1 or Step 2 to regain access

---

## Section 6: Data Lost / Accidentally Deleted

### 6A: User deleted their own contacts/deals

**Within 30 days — use Trash:**
1. Go to `/tenant/trash`
2. Find deleted records
3. Click "Restore"

**After 30 days — use backup restore:**
1. Super admin → `/superadmin/selective-restore`
2. Select tenant → Select backup date → Preview data
3. Choose specific tables/records to restore
4. Execute restore

### 6B: Find and restore a SPECIFIC user's data

**Search for user:**
```bash
curl -H "Cookie: nucrm_session=YOUR_TOKEN" \
  "http://your-server/api/superadmin/user-data?search=user@email.com"
```

**Get summary of their data:**
```bash
curl -H "Cookie: nucrm_session=YOUR_TOKEN" \
  "http://your-server/api/superadmin/user-data?user_id=USER_ID&tenant_id=TENANT_ID&action=summary"
```

**Export all their data:**
```bash
curl -H "Cookie: nucrm_session=YOUR_TOKEN" \
  "http://your-server/api/superadmin/user-data?user_id=USER_ID&tenant_id=TENANT_ID&action=export"
```

**Restore specific records from backup:**
```bash
curl -X POST -H "Cookie: nucrm_session=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  "http://your-server/api/superadmin/user-data" \
  -d '{
    "user_id": "USER_ID",
    "tenant_id": "TENANT_ID",
    "records": {
      "contacts": [
        { "firstName": "John", "lastName": "Doe", "email": "john@example.com" }
      ],
      "deals": [
        { "title": "Big Deal", "value": "50000", "stage": "qualified" }
      ]
    }
  }'
```

### 6C: Entire tenant data wiped

1. Go to `/superadmin/selective-restore`
2. Select the tenant
3. Choose the latest backup before the deletion
4. Preview → Confirm → Execute full restore

Or via API:
```bash
# List available backups
curl -H "Cookie: nucrm_session=TOKEN" \
  "http://your-server/api/admin/tenant-restore?tenantId=TENANT_ID&listBackups=true"

# Restore from specific backup
curl -X PUT -H "Cookie: nucrm_session=TOKEN" \
  -H "Content-Type: application/json" \
  "http://your-server/api/admin/tenant-restore" \
  -d '{ "backupId": "BACKUP_ID", "confirmRestore": true }'
```

### 6D: GDPR Right-to-Erasure (delete all user data)

```bash
# Soft-delete all data owned by a user (recoverable for 30 days)
curl -X DELETE -H "Cookie: nucrm_session=TOKEN" \
  "http://your-server/api/superadmin/user-data?user_id=USER_ID&tenant_id=TENANT_ID&confirm=true"
```

---

## Section 7: System-Level Failures

### App won't start
```bash
# Check logs
pm2 logs web --lines 50
# or
docker compose logs web --tail 50

# Common causes:
# - Missing env vars: check .env
# - DB connection refused: check DATABASE_URL, pg is running
# - Port in use: check PORT env or kill existing process
# - OOM: increase memory limit or scale up
```

### Database unreachable
```bash
# Check connection
psql $DATABASE_URL -c "SELECT 1;"

# If using Neon: check https://status.neon.tech
# If self-hosted: systemctl restart postgresql
# If Docker: docker compose restart postgres
```

### Redis unreachable (cache/queues fail)
```bash
# App continues without Redis (in-memory fallback)
# But queues will stop processing

# Check Redis
redis-cli -u $REDIS_URL ping

# Restart
docker compose restart redis
# or
systemctl restart redis
```

### Workers not processing jobs
```bash
# Check worker status
pm2 status worker
# or
docker compose ps worker

# Restart workers
pm2 restart worker
# or
docker compose restart worker

# Check BullMQ dashboard (if installed)
# Or check Redis queue lengths:
redis-cli -u $REDIS_URL LLEN bull:send-email:wait
```

---

## Section 8: Redundancy & Prevention

### Automatic Backups
- **Frequency:** Every hour via cron (`/api/cron/auto-backup`)
- **Retention:** 90 days
- **Scope:** All tenants, all critical tables
- **Storage:** Database (backup_data column) + optional S3

### Manual Backup (before risky operations)
```bash
# Trigger immediate backup for a tenant
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  "http://localhost:3000/api/cron/auto-backup"

# Or per-tenant via super admin panel
```

### Environment Variables to Set for Full Recovery Capability
```bash
# .env (REQUIRED for emergency recovery)
EMERGENCY_RECOVERY_KEY=generate-64-char-random-string-here-use-openssl-rand-hex-32

# .env (REQUIRED for email-based recovery)
RESEND_API_KEY=re_xxxx       # or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
NEXT_PUBLIC_APP_URL=https://your-domain.com

# .env (REQUIRED for backups)
DATABASE_URL=postgresql://...
CRON_SECRET=your-cron-secret

# .env (OPTIONAL but recommended)
REDIS_URL=redis://localhost:6379
SENTRY_DSN=https://...@sentry.io/...
```

### Health Monitoring
- `/api/health` — returns 200 if app + DB are healthy
- `/api/cron/backup-health` — verifies backup integrity
- Sentry alerts on 5xx errors
- PM2 auto-restarts crashed processes

---

## Section 9: Recovery Loop Prevention

### What if the recovery itself fails?

| Recovery Method | If It Fails | Next Step |
|:---|:---|:---|
| Forgot password email | SMTP down | Admin resets via panel |
| Admin resets via panel | Admin also locked out | Emergency Recovery API |
| Emergency Recovery API | Key not set or app down | Direct DB access |
| Direct DB access | DB unreachable | Restart DB service |
| DB restart | Corrupted/lost | Restore from backup |
| Backup restore | No backups exist | Contact hosting provider for volume snapshot |
| Volume snapshot | Not available | Last resort: re-deploy fresh + import any available exports |

### Guaranteed Escape Hatches (ALWAYS work):
1. **SSH + psql** — if you have server access and DB credentials, you can ALWAYS reset any password
2. **Database backups** — auto-run every hour, kept 90 days
3. **Emergency API** — works even when app is partially broken (only needs DB connection)

---

## Section 10: Checklist — Set This Up NOW (Before Emergency)

- [ ] Set `EMERGENCY_RECOVERY_KEY` in production env (64+ chars)
- [ ] Verify forgot-password emails are delivering (send a test)
- [ ] Confirm auto-backup cron is running (`/api/cron/auto-backup`)
- [ ] Save `DATABASE_URL` in your password manager (not just in .env)
- [ ] Document SSH access credentials for your server
- [ ] Store this document offline (PDF in secure location)
- [ ] Test the emergency recovery endpoint once in staging
- [ ] Ensure at least 2 people have super admin access
- [ ] Set up Sentry alerts for production errors
- [ ] Configure PM2/Docker health checks for auto-restart

---

## API Quick Reference

| Endpoint | Method | Purpose | Auth Required |
|:---|:---:|:---|:---:|
| `/api/auth/forgot-password` | POST | Send reset email | No |
| `/api/auth/reset-password` | POST | Reset with token | No |
| `/api/emergency/recover` | POST | Emergency admin reset | EMERGENCY_KEY |
| `/api/emergency/recover` | GET | Check if configured | No |
| `/api/superadmin/user-data?search=` | GET | Find user by email | Super Admin |
| `/api/superadmin/user-data?user_id=&action=full` | GET | Export user's data | Super Admin |
| `/api/superadmin/user-data` | POST | Restore user records | Super Admin |
| `/api/superadmin/user-data?confirm=true` | DELETE | GDPR erasure | Super Admin |
| `/api/admin/tenant-restore` | GET | List tenant backups | Super Admin |
| `/api/admin/tenant-restore` | POST | Create tenant backup | Super Admin |
| `/api/admin/tenant-restore` | PUT | Restore from backup | Super Admin |
| `/api/superadmin/selective-restore/preview` | POST | Preview restore data | Super Admin |
| `/api/superadmin/selective-restore/execute` | POST | Execute selective restore | Super Admin |
| `/api/superadmin/selective-restore/rollback` | POST | Rollback a restore | Super Admin |
