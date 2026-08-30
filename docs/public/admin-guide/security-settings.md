# Security Settings

Protect your workspace with strong authentication, access policies, and auditing.

> 👤 **Tenant admin** — configure under **Settings → Security** and related pages.

---

## Two-factor authentication (2FA)

NuCRM supports **TOTP-based 2FA** (authenticator apps like Google Authenticator or Authy).

- Users enable 2FA from their own security settings.
- Admins can require 2FA as part of the workspace login policy.

---

## Single Sign-On (SSO)

Let people log in with your identity provider:

- **SAML 2.0**
- **OpenID Connect (OIDC)**
- **OAuth 2.0**

Configure your provider under SSO settings (metadata/endpoints, certificates, and an allowed email
domain). Once enabled, users authenticate through your IdP instead of a password.

---

## SCIM user provisioning

NuCRM supports **SCIM 2.0** for automated user provisioning and de-provisioning from your identity
provider. When a user is added or removed in your IdP, their NuCRM access can be kept in sync
automatically — ideal for larger teams.

---

## Login policy

Set rules for how people sign in, for example:

- Require 2FA.
- Password strength requirements (passwords are strongly hashed; a minimum length and complexity
  are enforced).
- **Brute-force protection** — repeated failed logins are tracked and can be blocked.

---

## IP allowlist

Restrict access to your workspace to specific IP addresses or ranges so only trusted networks can
connect.

---

## Sessions

Review **active sessions** and **revoke** any you don't recognize. Sessions are stored securely and
expire automatically; revoking one signs that device out.

---

## Field & record permissions

Beyond roles, control access at a fine grain:

- **Field permissions** — hide or lock specific fields.
- **Record permissions** — restrict individual records.

See [Team & Roles](./team-and-roles.md#advanced-access-control).

---

## Data protection

| Feature | What it provides |
| --- | --- |
| **Field-level encryption** | Sensitive fields are encrypted. |
| **Data loss prevention (DLP)** | Policies to monitor and prevent risky data exposure. |
| **Input sanitization** | Content is sanitized to prevent injection/XSS. |

---

## Audit & compliance

- **Audit log** — a full trail of changes and access, viewable under **Settings → Audit**.
- **Compliance** — support for **GDPR** (data subject requests, deletion, portability) and **SOC2**
  practices, with configurable **data retention** policies. See **Settings → Compliance**.

---

## Related

- [Team & Roles](./team-and-roles.md) — who can do what
- [Super-Admin → Security & Compliance](../../admin/security.md) — platform-level security (operators)
