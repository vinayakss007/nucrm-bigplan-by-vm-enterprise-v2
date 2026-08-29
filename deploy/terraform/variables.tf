###############################################################################
#  Input variables
###############################################################################

variable "cloud" {
  description = "Which cloud to provision on: 'hetzner' or 'digitalocean'."
  type        = string
  default     = "hetzner"

  validation {
    condition     = contains(["hetzner", "digitalocean"], var.cloud)
    error_message = "cloud must be either \"hetzner\" or \"digitalocean\"."
  }
}

variable "name" {
  description = "Base name/hostname for the VM and related resources."
  type        = string
  default     = "nucrm-prod"
}

variable "environment" {
  description = "Environment label applied as a tag/label."
  type        = string
  default     = "production"
}

# ── Provider tokens (set only the one you use; keep them out of git) ──────────
variable "hcloud_token" {
  description = "Hetzner Cloud API token. Required when cloud = hetzner."
  type        = string
  default     = ""
  sensitive   = true
}

variable "do_token" {
  description = "DigitalOcean API token. Required when cloud = digitalocean."
  type        = string
  default     = ""
  sensitive   = true
}

# ── Sizing (defaults follow deploy docs: 8GB / 4 vCPU) ────────────────────────
variable "hcloud_server_type" {
  description = "Hetzner server type. cx32 = 4 vCPU / 8GB, the documented target."
  type        = string
  default     = "cx32"
}

variable "hcloud_location" {
  description = "Hetzner location (e.g. nbg1, fsn1, hel1, ash, hil)."
  type        = string
  default     = "nbg1"
}

variable "hcloud_image" {
  description = "Hetzner base image."
  type        = string
  default     = "ubuntu-24.04"
}

variable "do_size" {
  description = "DigitalOcean droplet size. s-4vcpu-8gb matches the 8GB target."
  type        = string
  default     = "s-4vcpu-8gb"
}

variable "do_region" {
  description = "DigitalOcean region slug (e.g. nyc3, fra1, sfo3)."
  type        = string
  default     = "fra1"
}

variable "do_image" {
  description = "DigitalOcean base image slug."
  type        = string
  default     = "ubuntu-24-04-x64"
}

# ── Access & app config ───────────────────────────────────────────────────────
variable "ssh_public_keys" {
  description = <<-EOT
    SSH public keys authorized for the deploy user. At least one is required —
    the VM disables password SSH login. Provide the key text (e.g. the contents
    of ~/.ssh/id_ed25519.pub), not a file path.
  EOT
  type        = list(string)

  validation {
    condition     = length(var.ssh_public_keys) > 0
    error_message = "Provide at least one SSH public key; password login is disabled."
  }
}

variable "deploy_user" {
  description = "Non-root user created on the VM for deployment/operations."
  type        = string
  default     = "deploy"
}

variable "ssh_port" {
  description = "SSH port to expose (change from 22 to reduce noise if desired)."
  type        = number
  default     = 22
}

variable "admin_cidrs" {
  description = <<-EOT
    CIDR blocks allowed to reach SSH. Default is open (0.0.0.0/0) for
    convenience, but you SHOULD restrict this to your office/VPN ranges.
    HTTP/HTTPS (80/443) are always open to the world for the public app.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "domain" {
  description = "Public domain for the app (passed to the VM for reference/TLS)."
  type        = string
  default     = ""
}
