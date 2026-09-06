#!/usr/bin/env bash
# Idempotent Cloud Agent setup for the BOPOIL + Coat & Care monorepo.
# Runs after the repository is checked out. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Node.js 22 LTS
#
# The workspace pins Node >=22.13.0, but the test runner imports .ts files
# directly and relies on Node's unflagged TypeScript type stripping, which
# only became the default in Node 22.18.0. CI uses actions/setup-node with
# node-version: 22 (the latest 22.x), so we match that here. The Cloud Agent
# harness prepends /exec-daemon/node (an older 22.x) to PATH, so we also
# symlink the nvm binaries into the first writable PATH entry that precedes
# it, ensuring the newer Node wins in every shell.
# ---------------------------------------------------------------------------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22
nvm alias default 22 >/dev/null

NVM_BIN="$(nvm which 22 | xargs dirname)"
for dir in /usr/local/cargo/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -w "$dir" ] || { [ ! -e "$dir" ] && mkdir -p "$dir" 2>/dev/null; }; then
    for bin in node npm npx corepack; do
      [ -e "$NVM_BIN/$bin" ] && ln -sf "$NVM_BIN/$bin" "$dir/$bin"
    done
    break
  fi
done
export PATH="$NVM_BIN:$PATH"
echo "Using Node $(node --version) / npm $(npm --version)"

# ---------------------------------------------------------------------------
# 2. JavaScript dependencies
# ---------------------------------------------------------------------------
npm ci

# ---------------------------------------------------------------------------
# 3. PostgreSQL (durable database used by the Next.js server-side code)
# ---------------------------------------------------------------------------
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

PG_VERSION="$(ls /usr/lib/postgresql/ | sort -V | tail -n1)"
sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true

# Wait for the server to accept connections.
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

sudo -u postgres psql -tc "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='coat_care'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE coat_care;" >/dev/null
fi

# ---------------------------------------------------------------------------
# 4. Local environment file (never overwrite an existing one)
# ---------------------------------------------------------------------------
ENV_FILE="apps/coat-care/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/coat_care
SALON_OWNER_EMAIL=info@bopoil.ca
AUTH_HASH_SECRET=local-dev-auth-hash-secret-please-change
CRON_SECRET=local-dev-cron-secret
SEED_DEMO_DATA=true
SQUARE_ORGANIZATION_SLUG=bopoil
SQUARE_LOCATION_SLUG=gatineau
EOF
  echo "Wrote $ENV_FILE"
fi

# ---------------------------------------------------------------------------
# 5. Database migrations (drizzle migrate is idempotent)
# ---------------------------------------------------------------------------
npm run db:migrate

echo "Coat & Care development environment is ready."
