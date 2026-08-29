###############################################################################
#  NuCRM — Infrastructure as Code (#897)
#
#  Provisions the single 8GB VM that runs the NuCRM production stack, on either
#  Hetzner Cloud (default — CX32, per deploy docs) or DigitalOcean. Pick one with
#  var.cloud. The VM boots via cloud-init (see cloud-init.yaml.tftpl), which
#  installs Docker, creates a non-root deploy user, and hardens SSH. The app
#  itself is then deployed with deploy/scripts/deploy.sh (Docker Compose).
#
#  This is intentionally a single-VM design that mirrors the documented
#  architecture (Docker Compose on one box). It is NOT a Kubernetes cluster.
###############################################################################

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }

  # Remote state is strongly recommended for a real deployment so the state is
  # not lost and can be locked. Uncomment and configure one backend. Example for
  # an S3-compatible store (AWS S3, MinIO, Backblaze B2, etc.):
  #
  # backend "s3" {
  #   bucket                      = "nucrm-tfstate"
  #   key                         = "prod/terraform.tfstate"
  #   region                      = "us-east-1"
  #   endpoints                   = { s3 = "https://s3.your-provider.com" }
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   use_path_style              = true
  # }
}

# Providers are configured with tokens from variables. Only the provider named
# by var.cloud actually creates resources (the other has zero resources), but
# both must be declared. Leave the unused provider's token empty.
provider "hcloud" {
  token = var.hcloud_token
}

provider "digitalocean" {
  token = var.do_token
}
