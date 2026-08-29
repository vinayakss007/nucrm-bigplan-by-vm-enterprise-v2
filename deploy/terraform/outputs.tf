###############################################################################
#  Outputs
###############################################################################

locals {
  public_ipv4 = local.is_hetzner ? try(hcloud_server.vm[0].ipv4_address, "") : try(digitalocean_droplet.vm[0].ipv4_address, "")
}

output "public_ipv4" {
  description = "Public IPv4 address of the provisioned VM."
  value       = local.public_ipv4
}

output "ssh_command" {
  description = "SSH into the VM as the deploy user."
  value       = "ssh -p ${var.ssh_port} ${var.deploy_user}@${local.public_ipv4}"
}

output "next_steps" {
  description = "What to do after terraform apply."
  value       = <<-EOT
    VM is up at ${local.public_ipv4} (cloud: ${var.cloud}).

    1. Point your DNS A record for '${var.domain != "" ? var.domain : "<your-domain>"}' at ${local.public_ipv4}.
    2. Wait for cloud-init to finish (check: ssh ... 'test -f /etc/nucrm-provisioned && echo ready').
    3. Copy the repo + a filled-in .env to the VM, then:
         bash deploy/scripts/setup-firewall.sh          # refine host firewall
         bash deploy/scripts/deploy.sh                  # bring up the stack
         bash deploy/scripts/setup-ssl.sh               # issue the TLS cert
    4. Verify: curl -sSf https://${var.domain != "" ? var.domain : local.public_ipv4}/health
  EOT
}
