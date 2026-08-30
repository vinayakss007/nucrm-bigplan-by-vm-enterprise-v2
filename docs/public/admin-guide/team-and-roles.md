# Team & Roles

Control who is in your workspace and what they can do.

> 👤 **Tenant admin** — requires an admin/owner role.

---

## Inviting team members

**Settings → Team → Invite**. Enter the person's email and choose a role. They receive an email
invitation; accepting it lets them set a password and join your workspace.

- Invitations are tied to your workspace only.
- You can re-send or revoke pending invitations.
- Email must be configured for invites to send — see [Integrations](./integrations.md).

---

## Roles

A **role** is a named bundle of permissions. NuCRM ships with sensible defaults and lets you create
your own.

### Built-in roles

| Role | Typical use |
| --- | --- |
| **Admin** | Full access to the workspace, including settings. |
| **Manager** | Broad access to CRM data and team oversight, limited settings. |
| **Sales rep** | Day-to-day CRM work on their own and team records. |
| **Viewer** | Read-only access. |

### Custom roles

Create custom roles with exactly the permissions you need. Roles are defined per workspace, so you
can tailor them to how your team operates.

---

## Permissions

Permissions are expressed as **resource + action** (for example, view or edit contacts, manage
deals, run reports, change settings). When you build or edit a role, you select which permissions
it grants.

- **Admins** implicitly have all permissions.
- Actions the product considers higher-risk are marked accordingly so you can grant them
  deliberately.

### Advanced access control

Beyond role permissions, NuCRM supports finer-grained control:

| Control | What it does |
| --- | --- |
| **Field permissions** | Restrict who can see or edit specific fields. |
| **Record permissions** | Grant or restrict access to individual records. |
| **Hierarchy / territories** | Scope what people see based on team hierarchy or territory. |

---

## Managing existing members

- **Change a role** — update a member's role at any time; changes take effect on their next
  authenticated request.
- **Deactivate / remove** — revoke access when someone leaves. Their historical activity is
  retained for audit.
- **Sessions** — admins can review and revoke active sessions from the security settings; see
  [Security Settings](./security-settings.md).

---

## Related

- [Security Settings](./security-settings.md) — 2FA, SSO, SCIM provisioning, login policy
- [Workspace Admin Overview](./README.md)
