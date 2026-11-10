#!/usr/bin/env bash
# #3264 — start any stopped NuCRM rootless-Podman containers.
#
# `--restart unless-stopped` is not a running supervisor on rootless Podman: it
# is honoured once at session start by podman-restart.service, so a container
# that dies later (OOM, reboot race, an operator stop) stays dead. This script
# is the timer's ExecStart; `nucrm-containers.timer` runs it every two minutes.
#
# The list is DERIVED from `podman ps -a`, not allow-listed. An allow-list goes
# stale the moment a container is added, which is the same class of bug as a
# config that quietly stops matching reality.
set -euo pipefail

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if ! command -v podman >/dev/null 2>&1; then
  log "podman is not installed; nothing to supervise"
  exit 0
fi

# `|| true` because grep exits 1 when there is nothing to match; under `set -e`
# that would turn "no containers yet" into a failed watchdog run.
all="$(podman ps -a --format '{{.Names}}' | grep -E '^nucrm-' || true)"
if [ -z "$all" ]; then
  log "no nucrm-* containers exist; nothing to supervise"
  exit 0
fi

running="$(podman ps --format '{{.Names}}' || true)"
started=0
failed=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  if printf '%s\n' "$running" | grep -qxF "$name"; then
    continue
  fi
  log "starting stopped container: $name"
  if ! podman start "$name" >/dev/null; then
    log "ERROR: podman start failed: $name"
    failed=$((failed + 1))
    continue
  fi
  started=$((started + 1))
done <<< "$all"

log "watchdog complete; started=$started failed=$failed"
[ "$failed" -eq 0 ] || exit 1
