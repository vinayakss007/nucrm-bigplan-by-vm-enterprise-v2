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

# #2814: the admin identity and the key that gates the bootstrap endpoint come
# from the operator running this script, never from the commit. `${VAR:?…}`
# exits before .env.local is written if either is missing, so a half-run
# install cannot leave a machine reachable with a published key.
ADMIN_EMAIL=${ADMIN_EMAIL:?ADMIN_EMAIL is required, e.g. ADMIN_EMAIL=you@company.com bash scripts/deploy-vm.sh}
ADMIN_PASSWORD=${ADMIN_PASSWORD:?ADMIN_PASSWORD is required: at least 8 characters per the endpoint schema, and 12+ including an uppercase letter, a number and a special character per its password policy}

# Generated per install, like JWT_SECRET below and DB_PASS above — the header
# further down and the SETUP_KEY in .env.local both read this one value.
SETUP_KEY=$(openssl rand -hex 16)

# The endpoint's password policy accepts `"` and `\`, and an unescaped one of
# those would arrive as invalid JSON — a 400 that looks like a wrong password.
ADMIN_PASSWORD_JSON=${ADMIN_PASSWORD//\\/\\\\}
ADMIN_PASSWORD_JSON=${ADMIN_PASSWORD_JSON//\"/\\\"}

# Create .env.local
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
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: $SETUP_KEY" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD_JSON\",\"full_name\":\"Admin\",\"workspace_name\":\"NuCRM\"}"

echo "=== Done ==="
echo "URL: http://$(hostname -I):3000"
