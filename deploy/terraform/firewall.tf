###############################################################################
#  Cloud-provider firewall — the public edge (#1036 backstop at the cloud layer)
#
#  Only SSH (restrictable via admin_cidrs), HTTP, and HTTPS are allowed inbound.
#  This is defence-in-depth ON TOP of the host UFW rules that
#  deploy/scripts/setup-firewall.sh applies — a mis-set host rule still can't
#  expose Postgres/Redis/monitoring because the cloud firewall drops them first.
###############################################################################

# ── Hetzner firewall ──────────────────────────────────────────────────────────
resource "hcloud_firewall" "web" {
  count = local.is_hetzner ? 1 : 0
  name  = "${var.name}-web"

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = tostring(var.ssh_port)
    source_ips  = var.admin_cidrs
    description = "SSH"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTP"
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "HTTPS"
  }

  # ICMP echo for basic reachability checks.
  rule {
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
    description = "ping"
  }

  labels = local.common_tags
}

# ── DigitalOcean firewall ─────────────────────────────────────────────────────
resource "digitalocean_firewall" "web" {
  count       = local.is_do ? 1 : 0
  name        = "${var.name}-web"
  droplet_ids = digitalocean_droplet.vm[*].id

  inbound_rule {
    protocol         = "tcp"
    port_range       = tostring(var.ssh_port)
    source_addresses = var.admin_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Allow all outbound (package installs, Let's Encrypt, S3, email, LLM APIs).
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}
