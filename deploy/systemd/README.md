# `deploy/systemd/` — host units, installed and pending

The two prune units below are **byte-identical copies** of what lives in `/etc/systemd/system/` on
the preprod host, so the repo documents the running state instead of describing an intention. The
`nginx.service.d/` drop-in and the container watchdog are the exceptions and are labelled as such
in their rows: they are written here and **not installed anywhere yet**, because a unit that only
exists in the repo cannot be verified against a host this repository does not have access to from CI.

| unit                          | installed | enabled                     | purpose                                                        |
| ----------------------------- | --------- | --------------------------- | -------------------------------------------------------------- |
| `nucrm-builder-prune.service` | yes       | — (triggered)               | `docker builder prune --force --max-used-space=40gb`           |
| `nucrm-builder-prune.timer`   | yes       | yes (`timers.target.wants`) | daily 05:20 UTC + `RandomizedDelaySec=20m`, `Persistent=true`  |
| `nginx.service.d/limits.conf` | **no**    | — (needs `daemon-reload`)   | `LimitNOFILE=65535`, so `worker_rlimit_nofile` is true (#3276) |
| `nucrm-containers.service`    | **no**    | — (triggered)               | starts stopped `nucrm-*` rootless Podman containers (#3264)    |
| `nucrm-containers.timer`      | **no**    | —                           | runs the watchdog every 2 minutes after the previous run       |

Why a host timer and not `deploy/cron/crontab`: that crontab is bind-mounted into `nucrm-cron`,
so editing it changes the live app scheduler with no restart, and it already holds destructive
jobs. Disk reclamation has nothing to do with the app scheduler (PP-033).

Verify before installing anywhere else:

```sh
docker builder prune --help | grep max-used-space          # the flag must exist (Docker 29.8 has it)
docker builder prune --force --max-used-space=999gb        # a cap above current usage prunes nothing: "Total: 0B"
systemd-analyze verify nucrm-builder-prune.{service,timer} # clean
```

Install (root, on the host):

```sh
sudo cp nucrm-builder-prune.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now nucrm-builder-prune.timer
systemctl list-timers nucrm-builder-prune.timer
```

Semantics worth knowing: `--max-used-space` evicts **until the cache fits under the cap, including
entries BuildKit counts as active** — which is the point, because a plain `docker builder prune -f`
leaves the residue (measured: 151.3 GB reported `0B reclaimable`, yet `docker buildx du` called
114.9 GB of it reclaimable). Cost is a slower next build, never a broken running container.

## Container watchdog (#3264)

Rootless Podman does **not** supervise a container after session start. `--restart unless-stopped`
is honoured once by `podman-restart.service`; a container that dies later stays dead, and pm2 only
knows about the app processes. These three files are a **user** timer that starts every stopped
`nucrm-*` container:

```sh
mkdir -p ~/.local/bin ~/.local/state
install -m 0755 deploy/systemd/start-containers.sh ~/.local/bin/nucrm-start-containers.sh
install -m 0644 deploy/systemd/nucrm-containers.service \
                deploy/systemd/nucrm-containers.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now nucrm-containers.timer
systemctl --user list-timers nucrm-containers.timer
```

Run it as the same user that owns the rootless containers, and enable lingering so the timer runs
without a login session:

```sh
loginctl enable-linger "$USER"
```

Verify the unit files without installing them:

```sh
systemd-analyze verify deploy/systemd/nucrm-containers.{service,timer}
```

Two traps are load-bearing and already encoded in the files:

1. **`OnUnitInactiveSec`, never `OnUnitActiveSec`.** A `Type=oneshot` service is inactive after it
   exits, so `OnUnitActiveSec` computes an infinite next elapse and the timer never re-arms.
2. **`KillMode=process`.** `podman start` leaves `rootlessport`/`conmon` children in the unit's
   cgroup. The default kill mode SIGKILLs the port forwarder when the oneshot exits, so `:3002`
   and `:9080` go dead while `podman ps` still reports the container running. `podman restart`
   does not restore those bindings; a stop + start does.

The container list is derived (`podman ps -a --format '{{.Names}}' | grep -E '^nucrm-'`), not
allow-listed, so a new `nucrm-*` service is covered without editing the unit. There is no user
journal on the target host, so the service appends its output to
`~/.local/state/nucrm-containers.log`.
