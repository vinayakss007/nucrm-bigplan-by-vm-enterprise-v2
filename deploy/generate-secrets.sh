#!/usr/bin/env bash
###############################################################################
#  NuCRM — Generate All Production Secrets
#  
#  Usage: bash deploy/generate-secrets.sh
#  Output: Prints all secrets to stdout. Pipe to file or copy manually.
###############################################################################
set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  NuCRM — Production Secrets Generator"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "# Copy these into your .env file:"
echo ""
echo "JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')"
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "SETUP_KEY=$(openssl rand -hex 24)"
echo "CRON_SECRET=$(openssl rand -hex 48)"
echo "EMERGENCY_RECOVERY_KEY=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '\n/+=' | head -c 32)"
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '\n/+=' | head -c 16)"
echo "AWS_ACCESS_KEY_ID=nucrm$(openssl rand -hex 8)"
echo "AWS_SECRET_ACCESS_KEY=$(openssl rand -base64 32 | tr -d '\n/+=')"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  IMPORTANT: Store these securely. They cannot be recovered."
echo "═══════════════════════════════════════════════════════════"
