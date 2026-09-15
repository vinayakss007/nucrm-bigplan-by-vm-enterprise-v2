# Host hardening not applied: UFW, SSH hardening, `infra-readiness.sh` (PP-020)

**Severity:** MEDIUM — hardening pending
**Area:** Infra / deploy · Security
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-020](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

The VM still runs with default firewall/SSH posture: UFW rules are not applied, SSH still permits
password/root login, and `deploy/scripts/infra-readiness.sh` has not been run. These change access to the
box, so they are deliberately not applied unattended.

## Steps to reproduce

```bash
ufw status                          # inactive / default
grep -E '^(PermitRootLogin|PasswordAuthentication)' /etc/ssh/sshd_config
bash deploy/scripts/infra-readiness.sh --dry-run
```

## Expected vs actual

- **Expected:** only 80/443 (and the SSH port, ideally restricted to known IPs) reachable; key-only SSH;
  readiness script green.
- **Actual:** default posture.

## Proposed fix

Run `deploy/scripts/setup-firewall.sh` and the SSH hardening steps during a maintenance window **with**
a second SSH session kept open as a safety net, then re-run `infra-readiness.sh` and record the outcome
in the register. Needs an explicit go-ahead from the operator because it can lock out access if applied
incorrectly.
