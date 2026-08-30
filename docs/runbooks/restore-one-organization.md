# Restore ONE organization's data (plain-English guide)

**Who this is for:** a solo operator with little database knowledge who needs to
put back one organization's (one "tenant's") data after it was deleted, messed
up, or lost — **without touching the whole database.**

**The one thing to remember:** you do **not** need `psql`, `pg_restore`, or any
database command for this. NuCRM has a built-in Super Admin tool that does it
safely, shows you a preview first, and can undo itself.

> Restoring the _entire_ database (all organizations at once) is a different,
> riskier job — that's disaster recovery, see `disaster-recovery.md`. This guide
> is only for **one organization**.

---

## Before you start

1. You must be able to log in as a **Super Admin**.
2. Know **which organization** you're fixing (its name — you'll pick it from a list).
3. Stay calm: the safe modes below **do not delete anything**. There is also a
   snapshot + rollback if something looks wrong.

---

## The safe recipe (memorize this)

1. **Preview first.** Always. Previewing changes nothing.
2. **Use `upsert` mode.** It restores the data without deleting anything.
3. **Avoid `replace` mode** unless you truly want to wipe-and-replace. Even then,
   a snapshot is taken so you can roll back.

That's the whole safety story. The rest is just clicking.

---

## Option 1 — The UI (recommended for you)

This is the easy path. No commands.

1. Log in as **Super Admin**.
2. Go to **Super Admin → Selective Restore** (the page at `/superadmin/selective-restore`).
3. **Pick the backup** you want to restore from (usually the most recent good one).
4. **Preview** — the screen shows which organizations and tables are inside that
   backup, and how many records. Nothing is changed yet.
5. **Choose the organization** (tenant) and **the tables** you want back
   (e.g. just `contacts` and `deals`, or everything).
6. **Choose the mode:**
   - **Insert only** — only adds rows that are missing. Safest.
   - **Upsert** — adds missing rows and updates existing ones to match the
     backup. **This is the normal choice for "restore this org's data."**
   - **Replace** — ⚠️ **deletes** the current rows in those tables first, then
     restores. Only use if you really mean "throw away what's there now."
7. **Run it.** The tool takes an automatic **pre-restore snapshot** before it
   writes, then restores and shows you how many records it touched.
8. **If it looks wrong**, use the **Rollback** action on that restore's log entry
   to return to the snapshot.

For a whole-organization restore (all of one org's data, not table-by-table),
use **Super Admin → Backups** (`/superadmin/backups`) and restore the tenant's
backup there. By default it **merges** (does not delete current data).

---

## Option 2 — Commands (only if you can't reach the UI)

Same actions, done with `curl`. You need the app running and a **Super Admin
session token** in `ADMIN_TOKEN` (see "How to get a token" below).

Set these once:

```bash
APP="https://your-app.com"          # your app's URL
ADMIN_TOKEN="paste-your-superadmin-token-here"
```

### Step 1 — Preview the backup (reads only, changes NOTHING)

```bash
curl -X POST "$APP/api/superadmin/selective-restore/preview" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "backup_id": "THE_BACKUP_ID" }'
```

The response lists the **organizations** and **tables** in that backup with
record counts. Use it to pick what to restore.

> Don't know the backup id? Open **Super Admin → Backups**, or list per-tenant
> backups:
>
> ```bash
> curl -H "Authorization: Bearer $ADMIN_TOKEN" \
>   "$APP/api/admin/tenant-restore?listBackups=true&tenantId=THE_ORG_ID"
> ```
>
> And to find the org id, list all organizations:
>
> ```bash
> curl -H "Authorization: Bearer $ADMIN_TOKEN" "$APP/api/admin/tenant-restore"
> ```

### Step 2 — Restore (safe `upsert` mode)

```bash
curl -X POST "$APP/api/superadmin/selective-restore/execute" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "backup_id": "THE_BACKUP_ID",
        "tenant_id":  "THE_ORG_ID",
        "tables":     ["contacts", "deals"],
        "restore_mode": "upsert"
      }'
```

- Change `"tables"` to the tables you want back.
- The response streams progress and, when done, gives a **records affected**
  summary. Keep the **restore log id** from the response — you need it to roll
  back.

**Modes:**

| `restore_mode` | What it does                                    | Safe?          |
| -------------- | ----------------------------------------------- | -------------- |
| `insert_only`  | Adds only missing rows                          | ✅ Safest      |
| `upsert`       | Adds missing + updates existing to match backup | ✅ Recommended |
| `replace`      | **Deletes** current rows first, then restores   | ⚠️ Destructive |

> `replace` is refused unless you also send `"confirm_restore": true`. That's a
> deliberate seatbelt. A pre-restore snapshot is always taken first.

### Step 3 — Rollback (only if the result is wrong)

```bash
curl -X POST "$APP/api/superadmin/selective-restore/rollback" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "restore_log_id": "THE_RESTORE_LOG_ID_FROM_STEP_2" }'
```

This returns the organization's tables to the snapshot taken just before the
restore.

---

## How to get a Super Admin token (for Option 2)

Easiest: open the app in your browser as a Super Admin, then copy the value of
the `nucrm_session` cookie and use it as the token — or, if your build issues a
Bearer token on login, use that. If you're not sure, **use Option 1 (the UI)**;
it needs no token.

---

## Frequently worried questions

- **"Will this delete the org's current data?"** No — not with `insert_only` or
  `upsert`. Only `replace` deletes, and only when you explicitly confirm it.
- **"Can I break other organizations?"** No. Selective restore is scoped to the
  one `tenant_id` you choose.
- **"What if I pick the wrong thing?"** Preview first (changes nothing). If a
  real restore goes wrong, roll back to the automatic snapshot.
- **"Do I need to know SQL?"** No. Prefer the UI.

---

## When NOT to use this guide

- **Whole database is gone / server died** → that's full disaster recovery. See
  `docs/runbooks/disaster-recovery.md` and the `npm run dr restore` flow.
- **You just need to un-delete a few records a user removed** → check whether the
  in-app trash/undo or the critical-data capture covers it before restoring from
  a backup.

---

_Related: `disaster-recovery.md` (full-DB recovery + `npm run dr` operator CLI)._
