###############################################################################
#  Compute — one VM on the selected cloud
#
#  Exactly one provider block is active (count = var.cloud == "..." ? 1 : 0).
#  The cloud-init user_data is shared between them.
###############################################################################

locals {
  is_hetzner = var.cloud == "hetzner"
  is_do      = var.cloud == "digitalocean"

  fqdn = var.domain != "" ? var.domain : var.name

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname        = var.name
    fqdn            = local.fqdn
    deploy_user     = var.deploy_user
    ssh_port        = var.ssh_port
    ssh_public_keys = var.ssh_public_keys
    domain          = var.domain
  })

  common_tags = {
    project     = "nucrm"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ── Hetzner Cloud ─────────────────────────────────────────────────────────────
resource "hcloud_ssh_key" "deploy" {
  count      = local.is_hetzner ? length(var.ssh_public_keys) : 0
  name       = "${var.name}-key-${count.index}"
  public_key = var.ssh_public_keys[count.index]
}

resource "hcloud_server" "vm" {
  count       = local.is_hetzner ? 1 : 0
  name        = var.name
  server_type = var.hcloud_server_type
  image       = var.hcloud_image
  location    = var.hcloud_location
  user_data   = local.user_data
  ssh_keys    = hcloud_ssh_key.deploy[*].id
  labels      = local.common_tags

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  firewall_ids = local.is_hetzner ? [hcloud_firewall.web[0].id] : []
}

# ── DigitalOcean ──────────────────────────────────────────────────────────────
resource "digitalocean_ssh_key" "deploy" {
  count      = local.is_do ? length(var.ssh_public_keys) : 0
  name       = "${var.name}-key-${count.index}"
  public_key = var.ssh_public_keys[count.index]
}

resource "digitalocean_droplet" "vm" {
  count      = local.is_do ? 1 : 0
  name       = var.name
  size       = var.do_size
  image      = var.do_image
  region     = var.do_region
  user_data  = local.user_data
  ssh_keys   = digitalocean_ssh_key.deploy[*].fingerprint
  tags       = [for k, v in local.common_tags : "${k}:${v}"]
  monitoring = true
}
