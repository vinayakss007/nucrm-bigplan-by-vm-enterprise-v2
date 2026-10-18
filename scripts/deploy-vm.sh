#!/bin/bash
# NuCRM VM Auto-Deploy Script

set -e

echo "=== NuCRM Deployment ==="

# Update
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql-15
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Setup DB
DB_PASS=$(openssl rand -hex 16)
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '${DB_PASS}';"
sudo -u postgres createdb nucrm_db

# Clone
cd ~
git clone https://github.com/vinayakss007/nu2-byopen-510.git
cd nu2-byopen-510

# Create .env.local
# #2814: SETUP_KEY is the only thing gating POST /api/setup/create-admin, which mints
# the platform's single super admin (app/api/setup/create-admin/route.ts:52-57, :44-46).
# It used to be a literal committed here, so anyone reading this public repo could claim
# that admin on any VM this script had provisioned. Generated per install, like the two
# secrets either side of it; read it back from .env.local when the setup form asks.
SETUP_KEY=$(openssl rand -hex 16)
# The admin identity is the operator's, never the commit's. lib/auth/session.ts:38-47 is
# the real policy (>=12 chars, one uppercase, one digit, one special), so both guards fail
# here rather than two lines later as a 400 from the API. No apostrophes in these messages:
# bash fails to PARSE `${VAR:?it's set}` at line 2, before it ever looks at the environment.
: "${ADMIN_EMAIL:?ADMIN_EMAIL must be set before running this script (the admin sign-in address)}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD must be set before running this script (at least 12 chars with an uppercase letter, a digit and a special character)}"
cat > .env.local << EOF
DATABASE_URL=postgresql://postgres:${DB_PASS}@localhost:5432/nucrm_db
DATABASE_SSL=false
JWT_SECRET=$(openssl rand -hex 32)
SETUP_KEY=${SETUP_KEY}
EOF

# Install & Deploy
npm install
npm run db:push

# Create admin
# node, not shell interpolation, because the password is JSON data: a quote or backslash in
# it would otherwise break the body. nodejs is installed above (line 12-13).
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: ${SETUP_KEY}" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({ email: process.argv[1], password: process.argv[2], full_name: "Admin", workspace_name: "NuCRM" }))' "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}")"

echo "=== Done ==="
echo "Admin created; this install's SETUP_KEY is in .env.local, nowhere else."
echo "URL: http://$(hostname -I):3000"