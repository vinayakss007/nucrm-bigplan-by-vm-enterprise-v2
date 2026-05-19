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
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'nucrm_pass';" 
sudo -u postgres createdb nucrm_db

# Clone
cd ~
git clone https://github.com/vinayakss007/nu2-byopen-510.git
cd nu2-byopen-510

# Create .env.local
cat > .env.local << EOF
DATABASE_URL=postgresql://postgres:nucrm_pass@localhost:5432/nucrm_db
DATABASE_SSL=false
JWT_SECRET=$(openssl rand -hex 32)
SETUP_KEY=admin-setup-key-2026
EOF

# Install & Deploy
npm install
npm run db:push

# Create admin
curl -X POST http://localhost:3000/api/setup/create-admin \
  -H "Content-Type: application/json" \
  -H "X-Setup-Key: admin-setup-key-2026" \
  -d '{"email":"admin@nu2.com","password":"AdminPass123!","full_name":"Admin","workspace_name":"NuCRM"}'

echo "=== Done ==="
echo "URL: http://$(hostname -I):3000"