# `deploy/systemd/` — host units that are actually installed

These two files are **byte-identical copies** of what lives in `/etc/systemd/system/` on the
preprod host, so the repo documents the running state instead of describing an intention.

| unit                          | installed | enabled                     | purpose                                                       |
| ----------------------------- | --------- | --------------------------- | ------------------------------------------------------------- |
| `nucrm-builder-prune.service` | yes       | — (triggered)               | `docker builder prune --force --max-used-space=40gb`          |
| `nucrm-builder-prune.timer`   | yes       | yes (`timers.target.wants`) | daily 05:20 UTC + `RandomizedDelaySec=20m`, `Persistent=true` |

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
