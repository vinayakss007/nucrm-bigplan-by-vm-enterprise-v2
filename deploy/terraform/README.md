# NuCRM — Infrastructure as Code (#897)

Terraform that provisions the single production VM (the documented 8GB / 4 vCPU
box) on **Hetzner Cloud** (default) or **DigitalOcean**, boots it with a
hardened cloud-init, and puts a cloud-provider firewall in front that only
allows SSH / HTTP / HTTPS.

This replaces "manual VM provisioning" — the box is now reproducible from code.
It does **not** deploy the app; that stays with `deploy/scripts/deploy.sh` after
the VM exists (keeping app config/secrets out of Terraform state).

## What it creates

- One VM (`hcloud_server` or `digitalocean_droplet`) sized to 8GB/4vCPU.
- SSH keys registered with the provider.
- A cloud firewall allowing only SSH (`admin_cidrs`), 80, 443, and ICMP.
- cloud-init bootstrap that:
  - creates a non-root `deploy` user (in the `docker` + `sudo` groups),
  - installs Docker Engine + the Compose plugin, `postgresql-client`, `git`,
  - enables UFW (22/80/443), `fail2ban`, and unattended security upgrades,
  - hardens SSH (no root, no password, configurable port),
  - creates `/var/backups/nucrm` (matches `BACKUP_DIR` in `.env.production`).

## Prerequisites

- Terraform >= 1.6 (or OpenTofu).
- A Hetzner **or** DigitalOcean API token.
- An SSH keypair; you provide the **public** key.

## Usage

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # then edit it

# Provide the token via env (preferred over putting it in tfvars):
export TF_VAR_hcloud_token=xxxxxxxx      # or: export TF_VAR_do_token=xxxxxxxx

terraform init
terraform plan
terraform apply

# Grab the outputs
terraform output public_ipv4
terraform output -raw ssh_command
```

Then finish the app bring-up (see `terraform output next_steps`):

```bash
# Point DNS at the new IP, copy the repo + filled-in .env to the VM, then on the VM:
bash deploy/scripts/setup-firewall.sh     # refine host firewall (+ Docker/UFW hardening)
bash deploy/scripts/deploy.sh             # start the Docker Compose stack
bash deploy/scripts/setup-ssl.sh          # issue Let's Encrypt cert for $DOMAIN
```

## Switching cloud

Set `cloud = "digitalocean"` (and `do_token` / `do_region` / `do_size`) or
`cloud = "hetzner"`. Only the selected provider creates resources.

## State & secrets

- `terraform.tfvars`, `*.tfstate`, and plan files are **gitignored** — they can
  contain tokens. Use **remote state** for real deployments: uncomment and
  configure the `backend "s3"` block in `versions.tf` (works with AWS S3 or the
  MinIO/B2 you already run).
- Prefer `TF_VAR_*` environment variables for tokens over writing them to disk.

## Destroy

```bash
terraform destroy
```

> Destroying removes the VM and its disk. Ensure you have a current backup
> (`deploy/scripts/backup.sh`) and that off-VM/offsite copies exist first.
